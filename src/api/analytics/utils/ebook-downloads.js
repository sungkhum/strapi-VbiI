'use strict';

const crypto = require('node:crypto');

/**
 * Daily eBook download counts, read by PlovPit Insights.
 *
 * The site's `/api/track-click?type=ebook` redirect calls `recordEbookDownload` once per request.
 * It adds one to the resource's lifetime `eBookDownloads` counter and to that resource's count for
 * the current Cambodia calendar day, in one transaction. The export reports every complete day
 * since counting began: a day without downloads is reported with an empty `books` list.
 */

const TIME_ZONE = 'Asia/Phnom_Penh';
const MAX_RANGE_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TOKEN_LENGTH = 32;

class RangeInputError extends Error {}

const isoDay = (time) => new Date(time).toISOString().slice(0, 10);

const addDays = (day, amount) => isoDay(new Date(`${day}T00:00:00.000Z`).getTime() + amount * DAY_MS);

/** A real calendar day: 2026-02-31 parses, but as 3 March, so it must survive a round trip. */
const isDay = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = new Date(`${value}T00:00:00.000Z`).getTime();
  return !Number.isNaN(time) && isoDay(time) === value;
};

/** Strapi 5 document IDs are short lowercase letters and digits. */
const isDocumentId = (value) => typeof value === 'string' && /^[a-z0-9]{1,64}$/.test(value);

/** Both dates are required and inclusive, and the range may cover at most 31 days. */
const parseRange = (query = {}) => {
  const { from, to } = query;
  if (!isDay(from) || !isDay(to)) {
    throw new RangeInputError('from and to must both be YYYY-MM-DD dates');
  }
  if (from > to) throw new RangeInputError('from must not be after to');
  if (Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1 > MAX_RANGE_DAYS) {
    throw new RangeInputError(`The range may cover at most ${MAX_RANGE_DAYS} days`);
  }
  return { from, to };
};

/**
 * The requested days that are complete and fully counted: from the first full day after
 * counting began through yesterday, both in Cambodia time.
 */
const reportedDays = ({ from, to }, { firstDay, today }) => {
  if (!firstDay || !today) return [];
  const start = from > firstDay ? from : firstDay;
  const yesterday = addDays(today, -1);
  const end = to < yesterday ? to : yesterday;
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
};

/** The export body: every reported day, with its books ordered by ID. */
const assembleExport = (range, coverage, rows) => {
  const days = new Map(reportedDays(range, coverage).map((day) => [day, []]));
  for (const row of rows) {
    const books = days.get(row.day);
    if (books) books.push({ id: row.document_id, title: row.title, count: Number(row.count) });
  }
  return {
    timeZone: TIME_ZONE,
    days: [...days].map(([date, books]) => ({ date, books })),
  };
};

/** The Khmer title, then the English title: the PlovPit app and Shop use the Khmer titles. */
const TITLE_SQL = (alias) =>
  `COALESCE(NULLIF(btrim(${alias}.khmer_title), ''), NULLIF(btrim(${alias}.english_title), ''))`;

/**
 * Counts one eBook download of a published resource. Returns false, and counts nothing,
 * when no published resource has this document ID.
 * `now` is for tests; the database clock is used otherwise.
 */
const recordEbookDownload = async (knex, documentId, { now } = {}) => {
  if (!isDocumentId(documentId)) return false;
  const at = now ? new Date(now).toISOString() : null;
  return knex.transaction(async (trx) => {
    const { rows } = await trx.raw(
      `SELECT ${TITLE_SQL('r')} AS title FROM resources r
        WHERE r.document_id = ? AND r.published_at IS NOT NULL
        ORDER BY r.id LIMIT 1`,
      [documentId]
    );
    if (!rows.length) return false;
    const title = rows[0].title || documentId;

    // Draft and published rows keep the same lifetime count, as Strapi's own publish did.
    await trx.raw(
      'UPDATE resources SET e_book_downloads = COALESCE(e_book_downloads, 0) + 1 WHERE document_id = ?',
      [documentId]
    );
    await trx.raw(
      `INSERT INTO ebook_download_days (day, document_id, title, count)
       VALUES ((COALESCE(?::timestamptz, now()) AT TIME ZONE ?)::date, ?, ?, 1)
       ON CONFLICT (day, document_id)
       DO UPDATE SET count = ebook_download_days.count + 1, title = EXCLUDED.title`,
      [at, TIME_ZONE, documentId, title]
    );
    await trx.raw(
      `INSERT INTO ebook_download_tracking (id, started_at)
       VALUES (1, COALESCE(?::timestamptz, now()))
       ON CONFLICT (id) DO NOTHING`,
      [at]
    );
    return true;
  });
};

/**
 * Today in Cambodia, and the first full Cambodia day after counting began (null until the first
 * download is counted). `at` is an ISO time for tests; the database clock is used otherwise.
 */
const loadCoverage = async (knex, at = null) => {
  const { rows: [clock] } = await knex.raw(
    `SELECT
       to_char((COALESCE(?::timestamptz, now()) AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS today,
       (SELECT to_char(
          CASE WHEN (started_at AT TIME ZONE ?)::time = time '00:00'
            THEN (started_at AT TIME ZONE ?)::date
            ELSE (started_at AT TIME ZONE ?)::date + 1 END,
          'YYYY-MM-DD')
        FROM ebook_download_tracking WHERE id = 1) AS first_day`,
    [at, TIME_ZONE, TIME_ZONE, TIME_ZONE, TIME_ZONE]
  );
  return { firstDay: clock.first_day, today: clock.today };
};

/** The export for an inclusive range of Cambodia days. `now` is for tests. */
const loadEbookDownloads = async (knex, range, { now } = {}) => {
  const coverage = await loadCoverage(knex, now ? new Date(now).toISOString() : null);
  const days = reportedDays(range, coverage);
  if (!days.length) return assembleExport(range, coverage, []);

  // A resource's current title, or the title it had when it was last downloaded.
  const { rows } = await knex.raw(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, d.document_id,
            COALESCE(${TITLE_SQL('r')}, d.title) AS title, d.count
       FROM ebook_download_days d
       LEFT JOIN LATERAL (
         SELECT khmer_title, english_title FROM resources
          WHERE document_id = d.document_id AND published_at IS NOT NULL
          ORDER BY id LIMIT 1
       ) r ON true
      WHERE d.day BETWEEN ?::date AND ?::date
      ORDER BY d.day, d.document_id`,
    [days[0], days[days.length - 1]]
  );
  return assembleExport(range, coverage, rows);
};

/** Constant-time comparison, so the response time does not reveal how much of a token matched. */
const tokenMatches = (given, expected) => {
  if (!given || !expected) return false;
  const left = crypto.createHash('sha256').update(String(given)).digest();
  const right = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(left, right);
};

/** The configured token, or null when it is missing or too short to resist guessing. */
const exportToken = (value) => {
  const token = String(value || '').trim();
  return token.length >= MIN_TOKEN_LENGTH ? token : null;
};

const bearerToken = (header) => {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  return match ? match[1].trim() : '';
};

module.exports = {
  MAX_RANGE_DAYS,
  RangeInputError,
  TIME_ZONE,
  assembleExport,
  bearerToken,
  exportToken,
  TITLE_SQL,
  isDocumentId,
  loadCoverage,
  loadEbookDownloads,
  parseRange,
  recordEbookDownload,
  reportedDays,
  tokenMatches,
};

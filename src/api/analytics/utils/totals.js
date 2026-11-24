'use strict';

const { TITLE_SQL, loadCoverage } = require('./ebook-downloads');
const { LINK_COUNTERS } = require('./link-clicks');

/**
 * The running totals behind the daily export, for PlovPit Insights' "All time" figures.
 *
 * `undated` holds the eBook downloads that no reported day covers: everything counted before the
 * first full day of daily counting (`before`), so the daily export plus `undated` is the whole
 * lifetime. Until daily counting begins, `before` is null and the whole lifetime is undated.
 * `linkClicks` holds each other link's lifetime counter, which has no daily counts at all.
 * Every resource is counted once, published or not; draft and published rows hold the same count.
 */
const loadTotals = async (knex, { now } = {}) => {
  const coverage = await loadCoverage(knex, now ? new Date(now).toISOString() : null);

  const { rows: books } = await knex.raw(
    `WITH lifetime AS (
       SELECT r.document_id,
              max(COALESCE(r.e_book_downloads, 0)) AS lifetime,
              (array_agg(${TITLE_SQL('r')} ORDER BY r.published_at IS NULL, r.id))[1] AS title
         FROM resources r
        WHERE r.document_id IS NOT NULL
        GROUP BY r.document_id
     ), dated AS (
       SELECT document_id, sum(count) AS dated
         FROM ebook_download_days
        WHERE ?::date IS NOT NULL AND day >= ?::date
        GROUP BY document_id
     )
     SELECT l.document_id, COALESCE(l.title, l.document_id) AS title,
            (l.lifetime - COALESCE(d.dated, 0))::int AS count
       FROM lifetime l LEFT JOIN dated d USING (document_id)
      WHERE l.lifetime - COALESCE(d.dated, 0) > 0
      ORDER BY count DESC, l.document_id`,
    [coverage.firstDay, coverage.firstDay]
  );

  const linkClicks = {};
  const tables = [...new Set(Object.values(LINK_COUNTERS).map((counter) => counter.table))];
  for (const table of tables) {
    const links = Object.entries(LINK_COUNTERS).filter(([, counter]) => counter.table === table);
    // Each document once: the largest of its draft and published counts.
    const perDocument = links.map(() => 'max(COALESCE(??, 0)) AS ??').join(', ');
    const sums = links.map(() => 'COALESCE(sum(??), 0)::int AS ??').join(', ');
    const { rows: [row] } = await knex.raw(
      `SELECT ${sums} FROM (
         SELECT ${perDocument} FROM ?? WHERE document_id IS NOT NULL GROUP BY document_id
       ) per_document`,
      [
        ...links.flatMap(([link]) => [link, link]),
        ...links.flatMap(([link, counter]) => [counter.column, link]),
        table,
      ]
    );
    for (const [link] of links) linkClicks[link] = Number(row[link]);
  }

  return {
    undated: {
      before: coverage.firstDay,
      ebookDownloads: books.reduce((sum, book) => sum + Number(book.count), 0),
      books: books.map((book) => ({ id: book.document_id, title: book.title, count: Number(book.count) })),
    },
    linkClicks,
  };
};

module.exports = { loadTotals };

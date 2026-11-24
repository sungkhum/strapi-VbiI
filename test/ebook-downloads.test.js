'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  RangeInputError,
  assembleExport,
  bearerToken,
  exportToken,
  isDocumentId,
  loadEbookDownloads,
  parseRange,
  recordEbookDownload,
  reportedDays,
  tokenMatches,
} = require('../src/api/analytics/utils/ebook-downloads');
const migration = require('../database/migrations/20261124000000_create_ebook_download_days');

test('ranges need both inclusive dates and cover at most 31 days', () => {
  assert.deepEqual(parseRange({ from: '2026-11-01', to: '2026-12-01' }), { from: '2026-11-01', to: '2026-12-01' });
  assert.deepEqual(parseRange({ from: '2026-11-20', to: '2026-11-20' }), { from: '2026-11-20', to: '2026-11-20' });
  for (const query of [
    {},
    { from: '2026-11-01' },
    { from: '2026-11-01', to: '2026-12-02' },
    { from: '2026-11-21', to: '2026-11-20' },
    { from: '2026-02-30', to: '2026-03-01' },
    { from: ['2026-11-01', '2026-11-02'], to: '2026-11-03' },
    { from: '2026-11-1', to: '2026-11-03' },
  ]) {
    assert.throws(() => parseRange(query), RangeInputError, JSON.stringify(query));
  }
});

test('reports complete days from the first full counted day through yesterday', () => {
  const range = { from: '2026-11-20', to: '2026-11-30' };
  assert.deepEqual(reportedDays(range, { firstDay: '2026-11-25', today: '2026-11-28' }), [
    '2026-11-25', '2026-11-26', '2026-11-27',
  ]);
  assert.deepEqual(reportedDays(range, { firstDay: null, today: '2026-11-28' }), []);
  assert.deepEqual(reportedDays(range, { firstDay: '2026-11-28', today: '2026-11-28' }), []);
  assert.deepEqual(reportedDays({ from: '2026-11-01', to: '2026-11-02' }, { firstDay: '2026-10-01', today: '2026-11-28' }), [
    '2026-11-01', '2026-11-02',
  ]);
});

test('an observed day without downloads has an empty books list', () => {
  const body = assembleExport(
    { from: '2026-11-25', to: '2026-11-26' },
    { firstDay: '2026-11-25', today: '2026-11-28' },
    [
      { day: '2026-11-25', document_id: 'abc', title: 'សៀវភៅ', count: '2' },
      { day: '2026-11-24', document_id: 'old', title: 'Not reported', count: 1 },
    ]
  );
  assert.deepEqual(body, {
    timeZone: 'Asia/Phnom_Penh',
    days: [
      { date: '2026-11-25', books: [{ id: 'abc', title: 'សៀវភៅ', count: 2 }] },
      { date: '2026-11-26', books: [] },
    ],
  });
});

test('the export token must be long, sent as a bearer token and match exactly', () => {
  assert.equal(exportToken('short'), null);
  assert.equal(exportToken(` ${'x'.repeat(32)} `), 'x'.repeat(32));
  assert.equal(bearerToken('Bearer abc '), 'abc');
  assert.equal(bearerToken('Basic abc'), '');
  assert.equal(tokenMatches('a'.repeat(32), 'a'.repeat(32)), true);
  assert.equal(tokenMatches('a'.repeat(31), 'a'.repeat(32)), false);
  assert.equal(tokenMatches('', 'a'.repeat(32)), false);
});

test('only plain document IDs are counted', () => {
  assert.equal(isDocumentId('cpvbzfo78fugyimsiyfjc1ee'), true);
  assert.equal(isDocumentId('12'), true);
  assert.equal(isDocumentId("x' OR 1=1"), false);
  assert.equal(isDocumentId(''), false);
  assert.equal(isDocumentId(12), false);
});

// The SQL needs a real Postgres: TEST_DATABASE_URL=postgres://... npm test
const databaseUrl = process.env.TEST_DATABASE_URL;

test('counts downloads per Cambodia day and keeps the lifetime counter in step', { skip: !databaseUrl && 'TEST_DATABASE_URL is not set' }, async () => {
  const schema = `ebook_test_${process.pid}`;
  const knex = require('knex')({ client: 'pg', connection: databaseUrl, searchPath: [schema], pool: { min: 1, max: 4 } });
  try {
    await knex.raw(`CREATE SCHEMA ${schema}`);
    await knex.raw(`
      CREATE TABLE resources (
        id serial PRIMARY KEY, document_id varchar(255), english_title varchar(255), khmer_title varchar(255),
        e_book_downloads integer, published_at timestamp(6)
      )`);
    await knex('resources').insert([
      { document_id: 'km', english_title: 'A Brief Introduction to the Bible', khmer_title: 'សៀវភៅ​ណែនាំ​ពី​ព្រះគម្ពីរ', e_book_downloads: 5, published_at: null },
      { document_id: 'km', english_title: 'A Brief Introduction to the Bible', khmer_title: 'សៀវភៅ​ណែនាំ​ពី​ព្រះគម្ពីរ', e_book_downloads: 5, published_at: new Date() },
      { document_id: 'en', english_title: 'English Only', khmer_title: '  ', e_book_downloads: null, published_at: new Date() },
      { document_id: 'draft', english_title: 'Draft', khmer_title: null, e_book_downloads: 0, published_at: null },
    ]);
    await migration.up(knex);
    await migration.up(knex);

    // Nothing is reported before the first download is counted.
    assert.deepEqual(
      await loadEbookDownloads(knex, { from: '2026-11-20', to: '2026-11-30' }, { now: '2026-11-30T05:00:00Z' }),
      { timeZone: 'Asia/Phnom_Penh', days: [] }
    );

    // 2026-11-24 10:00 in Cambodia: counting begins part way through the 24th.
    assert.equal(await recordEbookDownload(knex, 'km', { now: '2026-11-24T03:00:00Z' }), true);
    // 23:30 on the 25th in Cambodia.
    assert.equal(await recordEbookDownload(knex, 'km', { now: '2026-11-25T16:30:00Z' }), true);
    // 00:30 on the 26th in Cambodia, while it is still the 25th in UTC.
    assert.equal(await recordEbookDownload(knex, 'km', { now: '2026-11-25T17:30:00Z' }), true);
    assert.equal(await recordEbookDownload(knex, 'en', { now: '2026-11-25T17:40:00Z' }), true);
    // Unpublished, unknown and malformed IDs count nothing.
    assert.equal(await recordEbookDownload(knex, 'draft', { now: '2026-11-25T17:40:00Z' }), false);
    assert.equal(await recordEbookDownload(knex, 'missing', { now: '2026-11-25T17:40:00Z' }), false);
    assert.equal(await recordEbookDownload(knex, "km' --", { now: '2026-11-25T17:40:00Z' }), false);

    const lifetime = await knex('resources').select('document_id', 'published_at', 'e_book_downloads').orderBy('id');
    assert.deepEqual(lifetime.map((row) => row.e_book_downloads), [8, 8, 1, 0]);

    // On the 27th in Cambodia: the 24th was partly counted, the 25th and 26th are complete, the 27th is not over.
    const body = await loadEbookDownloads(knex, { from: '2026-11-20', to: '2026-11-30' }, { now: '2026-11-27T01:00:00Z' });
    assert.deepEqual(body, {
      timeZone: 'Asia/Phnom_Penh',
      days: [
        { date: '2026-11-25', books: [{ id: 'km', title: 'សៀវភៅ​ណែនាំ​ពី​ព្រះគម្ពីរ', count: 1 }] },
        { date: '2026-11-26', books: [{ id: 'en', title: 'English Only', count: 1 }, { id: 'km', title: 'សៀវភៅ​ណែនាំ​ពី​ព្រះគម្ពីរ', count: 1 }] },
      ],
    });

    // A resource that is later unpublished keeps the title it had when it was downloaded.
    await knex('resources').where({ document_id: 'en' }).update({ published_at: null });
    const later = await loadEbookDownloads(knex, { from: '2026-11-26', to: '2026-11-26' }, { now: '2026-11-27T01:00:00Z' });
    assert.deepEqual(later.days[0].books[0], { id: 'en', title: 'English Only', count: 1 });

    // Concurrent downloads are all counted.
    await Promise.all(Array.from({ length: 20 }, () => recordEbookDownload(knex, 'km', { now: '2026-11-28T03:00:00Z' })));
    const busy = await loadEbookDownloads(knex, { from: '2026-11-28', to: '2026-11-28' }, { now: '2026-11-29T03:00:00Z' });
    assert.deepEqual(busy.days, [{ date: '2026-11-28', books: [{ id: 'km', title: 'សៀវភៅ​ណែនាំ​ពី​ព្រះគម្ពីរ', count: 20 }] }]);
    const [published] = await knex('resources').where({ document_id: 'km' }).whereNotNull('published_at').select('e_book_downloads');
    assert.equal(published.e_book_downloads, 28);
  } finally {
    await knex.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await knex.destroy();
  }
});

test('counting that begins exactly at midnight in Cambodia reports that day', { skip: !databaseUrl && 'TEST_DATABASE_URL is not set' }, async () => {
  const schema = `ebook_midnight_${process.pid}`;
  const knex = require('knex')({ client: 'pg', connection: databaseUrl, searchPath: [schema], pool: { min: 1, max: 2 } });
  try {
    await knex.raw(`CREATE SCHEMA ${schema}`);
    await knex.raw('CREATE TABLE resources (id serial PRIMARY KEY, document_id varchar(255), english_title varchar(255), khmer_title varchar(255), e_book_downloads integer, published_at timestamp(6))');
    await knex('resources').insert({ document_id: 'a', english_title: 'A', khmer_title: null, published_at: new Date() });
    await migration.up(knex);
    // 2026-11-25 00:00 in Cambodia.
    await recordEbookDownload(knex, 'a', { now: '2026-11-24T17:00:00Z' });
    const body = await loadEbookDownloads(knex, { from: '2026-11-24', to: '2026-11-26' }, { now: '2026-11-26T17:00:00Z' });
    assert.deepEqual(body.days.map((day) => day.date), ['2026-11-25', '2026-11-26']);
  } finally {
    await knex.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await knex.destroy();
  }
});

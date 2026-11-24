'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadEbookDownloads, recordEbookDownload } = require('../src/api/analytics/utils/ebook-downloads');
const { LINK_COUNTERS } = require('../src/api/analytics/utils/link-clicks');
const { loadTotals } = require('../src/api/analytics/utils/totals');
const migration = require('../database/migrations/20261124000000_create_ebook_download_days');

// The SQL needs a real Postgres: TEST_DATABASE_URL=postgres://... npm test
const databaseUrl = process.env.TEST_DATABASE_URL;

test('undated eBook downloads plus the daily export add up to each lifetime counter', { skip: !databaseUrl && 'TEST_DATABASE_URL is not set' }, async () => {
  const schema = `totals_test_${process.pid}`;
  const knex = require('knex')({ client: 'pg', connection: databaseUrl, searchPath: [schema], pool: { min: 1, max: 2 } });
  try {
    await knex.raw(`CREATE SCHEMA ${schema}`);
    const counters = (table) => Object.values(LINK_COUNTERS).filter((counter) => counter.table === table)
      .map((counter) => `${counter.column} integer`).join(', ');
    await knex.raw(`CREATE TABLE resources (id serial PRIMARY KEY, document_id varchar(255), english_title varchar(255), khmer_title varchar(255), e_book_downloads integer, published_at timestamp(6), ${counters('resources')})`);
    await knex.raw(`CREATE TABLE missionary_resources (id serial PRIMARY KEY, document_id varchar(255), published_at timestamp(6), ${counters('missionary_resources')})`);
    const now = new Date();
    await knex('resources').insert([
      { document_id: 'bible', khmer_title: 'ព្រះគម្ពីរ', english_title: 'Bible', e_book_downloads: 100, audio_book_downloads: 7, purchase_link_click: 2, published_at: null },
      { document_id: 'bible', khmer_title: 'ព្រះគម្ពីរ', english_title: 'Bible', e_book_downloads: 100, audio_book_downloads: 7, purchase_link_click: 2, published_at: now },
      { document_id: 'old', khmer_title: null, english_title: 'Unpublished Book', e_book_downloads: 30, video_clicks: 4, published_at: null },
      { document_id: 'none', khmer_title: 'គ្មាន', english_title: 'None', e_book_downloads: null, published_at: now },
    ]);
    await knex('missionary_resources').insert([
      { document_id: 'guide', download_click: 3, published_at: null },
      { document_id: 'guide', download_click: 3, published_at: now },
    ]);
    await migration.up(knex);

    // Before daily counting begins, every lifetime download is undated.
    const before = await loadTotals(knex, { now: '2026-11-24T01:00:00Z' });
    assert.deepEqual(before.undated, {
      before: null,
      ebookDownloads: 130,
      books: [{ id: 'bible', title: 'ព្រះគម្ពីរ', count: 100 }, { id: 'old', title: 'Unpublished Book', count: 30 }],
    });
    assert.deepEqual(before.linkClicks, {
      audio: 7, video: 4, video_lessons: 0, external: 0, purchase: 2, english_kindle: 0, english_purchase: 0,
      missionary_download: 3, missionary_audio: 0, missionary_external: 0,
    });

    // Counting begins on the 24th (a partial day), so the 25th is the first reported day.
    await recordEbookDownload(knex, 'bible', { now: '2026-11-24T03:00:00Z' });
    await recordEbookDownload(knex, 'bible', { now: '2026-11-25T03:00:00Z' });
    await recordEbookDownload(knex, 'bible', { now: '2026-11-25T04:00:00Z' });
    await recordEbookDownload(knex, 'bible', { now: '2026-11-26T03:00:00Z' });

    // On the 26th: the 25th is reported, the 26th will be, and the 24th's partial day stays undated.
    const at = '2026-11-26T05:00:00Z';
    const totals = await loadTotals(knex, { now: at });
    assert.deepEqual(totals.undated, {
      before: '2026-11-25',
      ebookDownloads: 131,
      books: [{ id: 'bible', title: 'ព្រះគម្ពីរ', count: 101 }, { id: 'old', title: 'Unpublished Book', count: 30 }],
    });
    const reported = await loadEbookDownloads(knex, { from: '2026-11-01', to: '2026-11-30' }, { now: at });
    const dated = reported.days.flatMap((day) => day.books).reduce((sum, book) => sum + book.count, 0);
    const [{ lifetime }] = (await knex.raw("SELECT sum(e_book_downloads)::int AS lifetime FROM resources WHERE published_at IS NOT NULL OR document_id = 'old'")).rows;
    // Everything except today's download, which tomorrow's export reports.
    assert.equal(totals.undated.ebookDownloads + dated, lifetime - 1);
  } finally {
    await knex.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await knex.destroy();
  }
});

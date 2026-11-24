'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { LINK_COUNTERS, isCountedLink, recordLinkClick } = require('../src/api/analytics/utils/link-clicks');

test('only the site link types with a counter are accepted', () => {
  assert.equal(isCountedLink('audio'), true);
  assert.equal(isCountedLink('missionary_download'), true);
  for (const link of ['ebook', 'map', 'missionary_video', 'toString', '__proto__', 'published_at', '', undefined, 1]) {
    assert.equal(isCountedLink(link), false, String(link));
  }
});

// The SQL needs a real Postgres: TEST_DATABASE_URL=postgres://... npm test
const databaseUrl = process.env.TEST_DATABASE_URL;

test('counts a click on the draft and published rows without touching anything else', { skip: !databaseUrl && 'TEST_DATABASE_URL is not set' }, async () => {
  const schema = `link_test_${process.pid}`;
  const knex = require('knex')({ client: 'pg', connection: databaseUrl, searchPath: [schema], pool: { min: 1, max: 4 } });
  try {
    await knex.raw(`CREATE SCHEMA ${schema}`);
    const counters = (table) => Object.values(LINK_COUNTERS).filter((counter) => counter.table === table)
      .map((counter) => `${counter.column} integer`).join(', ');
    for (const table of ['resources', 'missionary_resources']) {
      await knex.raw(`CREATE TABLE ${table} (id serial PRIMARY KEY, document_id varchar(255), updated_at timestamp(6), published_at timestamp(6), ${counters(table)})`);
    }
    const published = new Date('2026-01-01T00:00:00Z');
    await knex('resources').insert([
      { document_id: 'book', audio_book_downloads: 4, purchase_link_click: null, updated_at: published, published_at: null },
      { document_id: 'book', audio_book_downloads: 4, purchase_link_click: null, updated_at: published, published_at: published },
      { document_id: 'draft', audio_book_downloads: 0, updated_at: published, published_at: null },
    ]);
    await knex('missionary_resources').insert([
      { document_id: 'guide', download_click: null, updated_at: published, published_at: null },
      { document_id: 'guide', download_click: null, updated_at: published, published_at: published },
    ]);

    assert.equal(await recordLinkClick(knex, 'audio', 'book'), true);
    assert.equal(await recordLinkClick(knex, 'purchase', 'book'), true);
    assert.equal(await recordLinkClick(knex, 'missionary_download', 'guide'), true);
    await Promise.all(Array.from({ length: 10 }, () => recordLinkClick(knex, 'audio', 'book')));
    // Unpublished, unknown and malformed entries, and links without a counter, count nothing.
    assert.equal(await recordLinkClick(knex, 'audio', 'draft'), false);
    assert.equal(await recordLinkClick(knex, 'audio', 'missing'), false);
    assert.equal(await recordLinkClick(knex, 'audio', "book' --"), false);
    assert.equal(await recordLinkClick(knex, 'missionary_download', 'book'), false);
    assert.equal(await recordLinkClick(knex, 'published_at', 'book'), false);

    const books = await knex('resources').orderBy('id');
    assert.deepEqual(books.map((row) => [row.audio_book_downloads, row.purchase_link_click]), [[15, 1], [15, 1], [0, null]]);
    // Not republished: the timestamps Strapi's publish would change stay as they were.
    assert.deepEqual(books.map((row) => row.published_at && row.published_at.getTime()), [null, published.getTime(), null]);
    assert.ok(books.every((row) => row.updated_at.getTime() === published.getTime()));
    const guides = await knex('missionary_resources').orderBy('id');
    assert.deepEqual(guides.map((row) => row.download_click), [1, 1]);
  } finally {
    await knex.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await knex.destroy();
  }
});

'use strict';

/**
 * Daily eBook download counts for the PlovPit Insights export
 * (`src/api/analytics/utils/ebook-downloads.js`).
 *
 * These are plain tables, not content types: Strapi leaves tables it did not create alone,
 * and the counts are only ever written with one atomic SQL statement per download.
 */
async function up(knex) {
  // One row per Cambodia calendar day and resource that had at least one download.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ebook_download_days (
      day date NOT NULL,
      document_id varchar(255) NOT NULL,
      title text NOT NULL,
      count integer NOT NULL CHECK (count > 0),
      PRIMARY KEY (day, document_id)
    );
  `);

  // When the first download was counted. Days before the first full day after it are not reported.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ebook_download_tracking (
      id smallint PRIMARY KEY CHECK (id = 1),
      started_at timestamptz NOT NULL
    );
  `);
}

async function down() {}

module.exports = { up, down };

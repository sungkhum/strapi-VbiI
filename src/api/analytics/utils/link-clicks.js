'use strict';

const { isDocumentId } = require('./ebook-downloads');

/**
 * The lifetime click counters behind the site's `/api/track-click` links, by the link's `type`.
 * eBook downloads have their own daily counter (`ebook-downloads.js`).
 */
const LINK_COUNTERS = {
  audio: { table: 'resources', column: 'audio_book_downloads' },
  video: { table: 'resources', column: 'video_clicks' },
  video_lessons: { table: 'resources', column: 'video_lessons_clicks' },
  external: { table: 'resources', column: 'external_link_clicks' },
  purchase: { table: 'resources', column: 'purchase_link_click' },
  english_kindle: { table: 'resources', column: 'english_kindle_clicks' },
  english_purchase: { table: 'resources', column: 'english_purchase_clicks' },
  missionary_download: { table: 'missionary_resources', column: 'download_click' },
  missionary_audio: { table: 'missionary_resources', column: 'audio_link_click' },
  missionary_external: { table: 'missionary_resources', column: 'external_link_click' },
};

const isCountedLink = (link) => typeof link === 'string' && Object.hasOwn(LINK_COUNTERS, link);

/**
 * Adds one click to a published entry's counter, on its draft and published rows alike, in one
 * statement. Unlike an update through Strapi, it does not republish the entry or fire webhooks.
 * Returns false, and counts nothing, when no published entry has this document ID.
 */
const recordLinkClick = async (knex, link, documentId) => {
  if (!isCountedLink(link) || !isDocumentId(documentId)) return false;
  const { table, column } = LINK_COUNTERS[link];
  const result = await knex.raw(
    `UPDATE ?? SET ?? = COALESCE(??, 0) + 1
      WHERE document_id = ?
        AND EXISTS (SELECT 1 FROM ?? published WHERE published.document_id = ? AND published.published_at IS NOT NULL)`,
    [table, column, column, documentId, table, documentId]
  );
  return result.rowCount > 0;
};

module.exports = { LINK_COUNTERS, isCountedLink, recordLinkClick };

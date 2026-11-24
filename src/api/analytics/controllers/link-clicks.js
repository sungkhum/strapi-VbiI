'use strict';

const { isDocumentId } = require('../utils/ebook-downloads');
const { isCountedLink, recordLinkClick } = require('../utils/link-clicks');

module.exports = {
  /** Counts one click on a tracked link: `{ "link": "audio", "documentId": "..." }`. */
  async record(ctx) {
    ctx.set('Cache-Control', 'no-store');
    const { link, documentId } = ctx.request.body || {};
    if (!isCountedLink(link)) return ctx.badRequest('link must be a counted link type');
    if (!isDocumentId(documentId)) return ctx.badRequest('documentId must be a document ID');
    try {
      const counted = await recordLinkClick(strapi.db.connection, link, documentId);
      if (!counted) return ctx.notFound('No published entry has this document ID');
      ctx.status = 204;
    } catch (error) {
      strapi.log.error('Link click could not be counted', error);
      return ctx.internalServerError('Link click could not be counted');
    }
  },
};

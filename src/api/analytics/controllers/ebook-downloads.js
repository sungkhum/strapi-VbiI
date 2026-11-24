'use strict';

const {
  RangeInputError,
  bearerToken,
  exportToken,
  isDocumentId,
  loadEbookDownloads,
  parseRange,
  recordEbookDownload,
  tokenMatches,
} = require('../utils/ebook-downloads');

const WINDOW_MS = 60 * 1000;
const EXPORTS_PER_WINDOW = 30;
const DENIED_PER_WINDOW = 10;
const windows = new Map();
let lastCleanupAt = 0;

const consumeRateLimit = (key, limit, now = Date.now()) => {
  if (now - lastCleanupAt >= WINDOW_MS) {
    lastCleanupAt = now;
    for (const [name, window] of windows) if (window.resetAt <= now) windows.delete(name);
  }
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
};

/**
 * The address to count attempts against. The platform's proxy sets X-Real-IP itself, while
 * the first X-Forwarded-For entry, which `ctx.ip` reads, is whatever the caller sent.
 */
const callerAddress = (ctx) => {
  const real = ctx.request.headers['x-real-ip'];
  const value = (Array.isArray(real) ? real[0] : real) || ctx.ip || 'unknown';
  return String(value).trim().slice(0, 64);
};

module.exports = {
  /** Counts one eBook download: `{ "documentId": "..." }`. */
  async record(ctx) {
    ctx.set('Cache-Control', 'no-store');
    const documentId = ctx.request.body && ctx.request.body.documentId;
    if (!isDocumentId(documentId)) return ctx.badRequest('documentId must be a resource document ID');
    try {
      const counted = await recordEbookDownload(strapi.db.connection, documentId);
      if (!counted) return ctx.notFound('No published resource has this document ID');
      ctx.status = 204;
    } catch (error) {
      strapi.log.error('eBook download could not be counted', error);
      return ctx.internalServerError('eBook download could not be counted');
    }
  },

  /**
   * Daily eBook download counts for PlovPit Insights: read-only, and closed unless
   * INSIGHTS_EXPORT_TOKEN holds a strong token that the caller sends as a bearer token.
   */
  async export(ctx) {
    ctx.set('Cache-Control', 'no-store');
    ctx.set('X-Content-Type-Options', 'nosniff');

    const expected = exportToken(process.env.INSIGHTS_EXPORT_TOKEN);
    // While it is off, the route answers like any unknown path.
    if (!expected) return ctx.notFound();

    const address = callerAddress(ctx);
    if (!tokenMatches(bearerToken(ctx.request.headers.authorization), expected)) {
      // Wrong tokens get their own small budget, so guessing is slow and cannot use up the
      // allowance of the real caller. Logged only within the budget, so a flood cannot fill the log.
      if (!consumeRateLimit(`denied:${address}`, DENIED_PER_WINDOW)) {
        ctx.status = 429;
        ctx.body = { error: 'Too many requests' };
        return;
      }
      strapi.log.warn(`eBook download export refused for ${address}`);
      return ctx.unauthorized('A valid insights token is required');
    }
    if (!consumeRateLimit(`export:${address}`, EXPORTS_PER_WINDOW)) {
      ctx.status = 429;
      ctx.body = { error: 'Too many requests' };
      return;
    }

    let range;
    try {
      range = parseRange(ctx.query);
    } catch (error) {
      if (error instanceof RangeInputError) return ctx.badRequest(error.message);
      throw error;
    }

    try {
      ctx.body = await loadEbookDownloads(strapi.db.connection, range);
    } catch (error) {
      strapi.log.error('eBook download export failed', error);
      return ctx.internalServerError('eBook download export failed');
    }
  },
};

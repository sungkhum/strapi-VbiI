'use strict';

const { buildIndex, search } = require('../../../utils/khmer-search');

/**
 * Search for the CCR site, in Khmer and English. Every published resource's titles, author and
 * publisher names and descriptions are indexed in memory (a few hundred resources) and ranked by
 * `src/utils/khmer-search.js`; the site's type, category, featured and author filters and its sort
 * options apply to the matches. Only the requested page is loaded in full.
 */

const INDEX_TTL = 5 * 60 * 1000;
const RESULT_TTL = 60 * 1000;
let cachedIndex = null;
const resultCache = new Map();

async function loadIndex() {
  const resources = await strapi.documents('api::resource.resource').findMany({
    status: 'published',
    fields: ['EnglishTitle', 'KhmerTitle', 'EnglishDescription', 'KhmerDescription', 'PublishedDate', 'IsFeatured'],
    populate: {
      type: { fields: ['slug'] },
      categories: { fields: ['slug'] },
      authors: { fields: ['Name'] },
      publishers: { fields: ['EnglishName', 'KhmerName'] },
    },
    limit: 10000,
  });
  return buildIndex(resources, (resource) => [
    { weight: 4, text: [resource.KhmerTitle, resource.EnglishTitle].filter(Boolean).join(' ') },
    {
      weight: 2,
      text: [
        ...(resource.authors || []).map((author) => author.Name),
        ...(resource.publishers || []).flatMap((publisher) => [publisher.EnglishName, publisher.KhmerName]),
      ].filter(Boolean).join(' '),
    },
    { weight: 1, text: [resource.KhmerDescription, resource.EnglishDescription].filter(Boolean).join(' ') },
  ]);
}

/** The search index, rebuilt at most every five minutes. A failed load is retried next time. */
function resourceIndex() {
  if (!cachedIndex || Date.now() - cachedIndex.at > INDEX_TTL) {
    const promise = loadIndex();
    cachedIndex = { at: Date.now(), promise };
    promise.catch(() => {
      if (cachedIndex && cachedIndex.promise === promise) cachedIndex = null;
    });
  }
  return cachedIndex.promise;
}

const text = (value) => (typeof value === 'string' ? value : Array.isArray(value) ? String(value[0] ?? '') : '');
const positive = (value, fallback, max) => {
  const number = Number.parseInt(text(value), 10);
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
};

/** The filters the site sends alongside a search. */
function matchesFilters(resource, { type, category, featured, author }) {
  if (type && type !== 'all' && !(resource.type || []).some((entry) => entry.slug === type)) return false;
  if (category && !(resource.categories || []).some((entry) => entry.slug === category)) return false;
  if (featured === 'true' && resource.IsFeatured !== true) return false;
  if (author && !(resource.authors || []).some((entry) => String(entry.id) === author)) return false;
  return true;
}

/** Relevance by default; the site's explicit sort options when chosen. */
function sorted(resources, sort) {
  const byDate = (a, b) => String(a.PublishedDate || '').localeCompare(String(b.PublishedDate || ''));
  const byTitle = (a, b) => String(a.EnglishTitle || '').localeCompare(String(b.EnglishTitle || ''));
  if (sort === 'date-asc') return [...resources].sort(byDate);
  if (sort === 'title-asc') return [...resources].sort(byTitle);
  if (sort === 'title-desc') return [...resources].sort((a, b) => byTitle(b, a));
  return resources;
}

// Helper function to sanitize user objects
const sanitizeUser = (user) => {
  if (!user) return null;
  return {
    id: user.id,
    firstname: user.firstname,
    lastname: user.lastname
  };
};

// Recursively sanitize sensitive fields from response data
const sanitizeData = (data) => {
  if (!data) return null;
  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }
  if (typeof data === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      if (['password', 'resetPasswordToken', 'registrationToken', 'email'].includes(key)) {
        continue;
      }
      if (key === 'createdBy' || key === 'updatedBy') {
        result[key] = sanitizeUser(value);
        continue;
      }
      result[key] = sanitizeData(value);
    }
    return result;
  }
  return data;
};

module.exports = {
  async khmerSearch(ctx) {
    try {
      const query = text(ctx.query.search).trim();
      const page = positive(ctx.query.page, 1, 10000);
      const pageSize = positive(ctx.query.pageSize, 25, 100);
      const filters = {
        type: text(ctx.query.type),
        category: text(ctx.query.category),
        featured: text(ctx.query.featured),
        author: text(ctx.query.author),
      };
      const sort = text(ctx.query.sort);

      if (!query) {
        return { data: [], meta: { pagination: { page: 1, pageSize, pageCount: 0, total: 0 } } };
      }

      const cacheKey = JSON.stringify([query, page, pageSize, filters, sort]);
      const cached = resultCache.get(cacheKey);
      if (cached && Date.now() - cached.at < RESULT_TTL) return cached.value;

      const matches = sorted(search(await resourceIndex(), query).filter((resource) => matchesFilters(resource, filters)), sort);
      const total = matches.length;
      const documentIds = matches.slice((page - 1) * pageSize, page * pageSize).map((resource) => resource.documentId);

      let data = [];
      if (documentIds.length) {
        const fullResults = await strapi.documents('api::resource.resource').findMany({
          filters: { documentId: { $in: documentIds } },
          status: 'published',
          populate: {
            FeaturedImage: true,
            eBook: true,
            authors: { fields: ['Name', 'slug'] },
            categories: { fields: ['EnglishName', 'KhmerName', 'slug'] },
            publishers: { fields: ['EnglishName', 'KhmerName', 'slug'] },
            type: { fields: ['EnglishName', 'KhmerName', 'slug'] },
          },
        });
        const byId = new Map(sanitizeData(fullResults).map((resource) => [resource.documentId, resource]));
        data = documentIds.map((id) => byId.get(id)).filter(Boolean);
      }

      const response = { data, meta: { pagination: { page, pageSize, pageCount: Math.ceil(total / pageSize), total } } };
      resultCache.set(cacheKey, { at: Date.now(), value: response });
      if (resultCache.size > 200) {
        for (const [key, entry] of resultCache) if (Date.now() - entry.at > RESULT_TTL) resultCache.delete(key);
      }
      return response;
    } catch (error) {
      strapi.log.error('Search error:', error);
      ctx.throw(500, 'Error performing search');
    }
  },
};

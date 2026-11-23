'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildIndex, search, searchKey, splitKhmer } = require('../src/utils/khmer-search');

const ZWSP = '​';
const DA = '្ដ';
const TA = '្ត';

test('search keys drop invisible characters and write subscript da as subscript ta', () => {
  assert.equal(searchKey(`ព្រះ${ZWSP}គម្ពីរ‌­`), 'ព្រះគម្ពីរ');
  assert.equal(searchKey(`ក${DA}`), `ក${TA}`);
  assert.equal(searchKey('  Grace  OF God '), 'grace of god');
});

test('splits run-together Khmer into the fewest catalog words', () => {
  const vocabulary = new Set(['មនុស្ស', 'បាប', 'មនុ']);
  assert.deepEqual(splitKhmer('មនុស្សបាប', vocabulary), ['មនុស្ស', 'បាប']);
  assert.equal(splitKhmer('មនុស្សល្អ', vocabulary), null);
});

const resources = [
  { documentId: 'a', KhmerTitle: `មនុស្ស${ZWSP}ដែល${ZWSP}មាន${ZWSP}បាប`, EnglishTitle: 'Sinful Man', PublishedDate: '2024-01-01', IsFeatured: true, type: [{ slug: 'book' }], categories: [], authors: [{ id: 7, Name: 'John Piper' }] },
  { documentId: 'b', KhmerTitle: `ការ${ZWSP}ស${DA}ាប់`, EnglishTitle: 'The Attributes of God', PublishedDate: '2025-01-01', IsFeatured: false, type: [{ slug: 'video' }], categories: [{ slug: 'theology' }], authors: [] },
  { documentId: 'c', KhmerTitle: 'ព្រះគុណ', EnglishTitle: 'Grace', EnglishDescription: 'the attributes of god in a phrase', PublishedDate: '2023-01-01', type: [{ slug: 'book' }], categories: [{ slug: 'theology' }], authors: [] },
];
const fieldsOf = (resource) => [
  { weight: 4, text: [resource.KhmerTitle, resource.EnglishTitle].join(' ') },
  { weight: 2, text: (resource.authors || []).map((author) => author.Name).join(' ') },
  { weight: 1, text: resource.EnglishDescription },
];
const ids = (query) => search(buildIndex(resources, fieldsOf), query).map((resource) => resource.documentId);

test('finds Khmer typed without the stored zero-width spaces, as a phrase or as words', () => {
  assert.deepEqual(ids('មនុស្សដែលមានបាប'), ['a']);
  assert.deepEqual(ids('មនុស្ស បាប'), ['a']);
  assert.deepEqual(ids('មនុស្សបាប'), ['a']);
  assert.deepEqual(ids(`ការស${TA}ាប់`), ['b']);
});

test('English words in any order, phrase matches first, author names too', () => {
  assert.deepEqual(ids('attributes of god'), ['b', 'c']);
  assert.deepEqual(ids('god attributes'), ['b', 'c']);
  assert.deepEqual(ids('piper'), ['a']);
  assert.deepEqual(ids('nothing here'), []);
});

// The endpoint, with a stand-in for Strapi's document service.
function controllerWith(found) {
  const calls = [];
  global.strapi = {
    log: { error() {} },
    documents() {
      return {
        async findMany(params) {
          calls.push(params);
          if (params.filters) return params.filters.documentId.$in.map((id) => ({ documentId: id, EnglishTitle: id, createdBy: { id: 1, firstname: 'A', email: 'x@y' } }));
          return found;
        },
      };
    },
  };
  delete require.cache[require.resolve('../src/api/resource/controllers/custom-search')];
  return { controller: require('../src/api/resource/controllers/custom-search'), calls };
}

test('the endpoint ranks, filters, pages and loads only the page in full', async () => {
  const { controller, calls } = controllerWith(resources);
  const run = (query) => controller.khmerSearch({ query, throw: (status) => { throw new Error(String(status)); } });

  const all = await run({ search: 'attributes god', page: '1', pageSize: '1' });
  assert.deepEqual(all.data.map((resource) => resource.documentId), ['b']);
  assert.deepEqual(all.meta.pagination, { page: 1, pageSize: 1, pageCount: 2, total: 2 });
  assert.deepEqual(calls.at(-1).filters.documentId.$in, ['b']);
  assert.equal(all.data[0].createdBy.email, undefined);

  assert.deepEqual((await run({ search: 'attributes god', type: 'book' })).data.map((r) => r.documentId), ['c']);
  assert.deepEqual((await run({ search: 'attributes god', category: 'theology', sort: 'date-asc' })).data.map((r) => r.documentId), ['c', 'b']);
  assert.deepEqual((await run({ search: 'បាប', featured: 'true', author: '7' })).data.map((r) => r.documentId), ['a']);
  assert.equal((await run({ search: '' })).meta.pagination.total, 0);
});

'use strict';

/**
 * Khmer-aware search over a small catalog held in memory. The same module (in TypeScript) serves
 * the Khmer Bible Atlas and plovpit.com's book search.
 *
 * Khmer is written without spaces. Editors put invisible zero-width spaces between words, which a
 * visitor's query never contains, and subscript ដ (្ដ) and ត (្ត) look the same in most fonts and are
 * typed either way. So the catalog and the query are both reduced to a search key: NFC, no
 * invisible characters, ្ដ written as ្ត, lower case, single spaces.
 *
 * Results come in three groups, each ranked by where it matched (titles before descriptions):
 * 1. the whole query as a phrase;
 * 2. every space-separated word of the query, in any order;
 * 3. every word of the query after splitting run-together Khmer into words the catalog uses.
 *
 * Splitting uses a vocabulary taken from the catalog itself (its invisible word breaks, plus the
 * runtime's Khmer word breaker), so it does not depend on one runtime's Khmer dictionary.
 */

const INVISIBLE = /[​-‍⁠﻿­]/g;
const WORD_BREAKS = /[\s​-‍⁠﻿­]+/;
const COENG_DA = /្ដ/g;
const KHMER = /[ក-៿᧠-᧿]/;
const KHMER_RUN = /[ក-៿᧠-᧿]+/g;
const MAX_QUERY = 120;
const MAX_WORD = 24;

/** The form both catalog text and queries are compared in. */
function searchKey(value) {
  if (!value) return '';
  return String(value)
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(COENG_DA, '្ត')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function segmenter() {
  try {
    return typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('km', { granularity: 'word' }) : null;
  } catch {
    return null;
  }
}

/** Every Khmer word the catalog's text uses: its own word breaks, and the runtime's. */
function buildVocabulary(texts) {
  const words = new Set();
  const breaker = segmenter();
  for (const text of texts) {
    if (!text) continue;
    for (const piece of String(text).normalize('NFC').split(WORD_BREAKS)) {
      for (const run of searchKey(piece).match(KHMER_RUN) || []) {
        if (run.length <= MAX_WORD) words.add(run);
        if (!breaker) continue;
        for (const part of breaker.segment(run)) {
          const word = part.segment.trim();
          if (word && KHMER.test(word) && word.length <= MAX_WORD) words.add(word);
        }
      }
    }
  }
  return words;
}

/** Splits a run of Khmer into the fewest catalog words covering all of it, or null. */
function splitKhmer(run, vocabulary) {
  const best = [[]];
  for (let end = 1; end <= run.length; end++) {
    best[end] = null;
    for (let start = Math.max(0, end - MAX_WORD); start < end; start++) {
      const before = best[start];
      const word = run.slice(start, end);
      if (before && vocabulary.has(word) && (!best[end] || before.length + 1 < best[end].length)) {
        best[end] = [...before, word];
      }
    }
  }
  return best[run.length] || null;
}

/** Prepares a catalog once. `fieldsOf(item)` returns [{ weight, text }], titles weighted highest. */
function buildIndex(items, fieldsOf) {
  const raw = [];
  const entries = items.map((item, order) => {
    const fields = fieldsOf(item);
    for (const field of fields) if (field.text) raw.push(field.text);
    return {
      item,
      order,
      fields: fields.map((field) => ({ weight: field.weight, key: searchKey(field.text) })).filter((field) => field.key),
    };
  });
  return { items: entries, vocabulary: buildVocabulary(raw) };
}

function rank(index, tokens) {
  const scored = [];
  for (const entry of index.items) {
    let score = 0;
    for (const token of tokens) {
      let best = 0;
      for (const field of entry.fields) if (field.weight > best && field.key.includes(token)) best = field.weight;
      if (!best) {
        score = 0;
        break;
      }
      score += best;
    }
    if (score) scored.push({ item: entry.item, order: entry.order, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((entry) => entry.item);
}

const unique = (tokens) => Array.from(new Set(tokens.filter(Boolean)));

/** Splits each Khmer run of a word into catalog words; other characters stay as they are. */
function khmerWords(word, vocabulary) {
  const parts = [];
  const runs = new RegExp(KHMER_RUN.source, 'g');
  let last = 0;
  let match;
  while ((match = runs.exec(word))) {
    if (match.index > last) parts.push(word.slice(last, match.index));
    parts.push(...(splitKhmer(match[0], vocabulary) || [match[0]]));
    last = match.index + match[0].length;
  }
  if (last < word.length) parts.push(word.slice(last));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The matching items, best first. An empty query returns every item in catalog order. */
function search(index, rawQuery) {
  const query = searchKey(rawQuery).slice(0, MAX_QUERY).trim();
  if (!query) return index.items.map((entry) => entry.item);

  const results = new Set(rank(index, [query]));
  const words = unique(query.split(' '));
  if (words.length > 1) for (const item of rank(index, words)) results.add(item);
  const pieces = unique(words.flatMap((word) => khmerWords(word, index.vocabulary)));
  if (pieces.length > words.length) for (const item of rank(index, pieces)) results.add(item);
  return Array.from(results);
}

module.exports = { searchKey, buildVocabulary, splitKhmer, buildIndex, search };

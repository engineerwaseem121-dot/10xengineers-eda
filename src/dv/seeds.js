'use strict';
/*
 * Seed lists, one syntax everywhere (Run Test, Run Regression, UVM, cocotb, dvflow --seeds):
 *   7                 one seed (re-run the exact same stimulus)
 *   1,5,9             a list
 *   0:100             a range, both ends included  (101 seeds)
 *   0:100:10          a range with a step          (0, 10, 20 … 100)
 *   random 50         50 random seeds (recorded, so every run can be reproduced)
 *   1,2,10:20,random 5   any mix; duplicates are dropped, order is kept
 */
const MAX_SEED = 2147483647;
const MAX_COUNT = 100000;

function parseSeeds(text, o) {
  o = o || {};
  const max = o.max || MAX_COUNT;
  const out = [];
  const seen = new Set();
  const add = n => { if (!seen.has(n)) { seen.add(n); out.push(n); } };
  const s = String(text == null ? '' : text).trim();
  if (!s) return { seeds: [], error: 'enter at least one seed, e.g. 1 or 0:100' };
  // "random N" may contain a space: split on commas first, then on whitespace between plain items
  const items = s.split(',').flatMap(part => { const p = part.trim(); return /^(random|rand)\s+\d+$/i.test(p) ? [p] : p.split(/\s+/); }).filter(Boolean);
  for (const it of items) {
    let m;
    if ((m = /^(?:random|rand)\s*(\d+)$/i.exec(it))) {
      const n = +m[1];
      if (n < 1) return { seeds: [], error: `"${it}": the count must be at least 1` };
      if (out.length + n > max) return { seeds: [], error: `too many seeds (more than ${max})` };
      for (let k = 0; k < n; k++) { let x; do { x = 1 + Math.floor(Math.random() * (MAX_SEED - 1)); } while (seen.has(x)); add(x); }
    } else if ((m = /^(-?\d+)(?::|\.\.)(-?\d+)(?::(\d+))?$/.exec(it))) {
      const a = +m[1], b = +m[2], step = m[3] ? +m[3] : 1;
      if (step < 1) return { seeds: [], error: `"${it}": the step must be 1 or more` };
      if (b < a) return { seeds: [], error: `"${it}": the range must go up (start:end, e.g. 0:100)` };
      const n = Math.floor((b - a) / step) + 1;
      if (out.length + n > max) return { seeds: [], error: `"${it}" is ${n} seeds; the limit is ${max}` };
      for (let x = a; x <= b; x += step) add(x);
    } else if (/^-?\d+$/.test(it)) {
      add(+it);
    } else {
      return { seeds: [], error: `"${it}" is not a seed: use 7, 1,5,9, 0:100, 0:100:10 or random 50` };
    }
  }
  if (out.some(x => Math.abs(x) > MAX_SEED)) return { seeds: [], error: `seeds must fit in 32 bits (±${MAX_SEED})` };
  return { seeds: out, error: null };
}

/** short description for logs and prompts: "0:100 (101 seeds)" */
function describe(text, seeds) {
  return `${String(text).trim()} (${seeds.length} seed${seeds.length === 1 ? '' : 's'})`;
}

const HELP = '7 = one seed (same stimulus again) · 1,5,9 · 0:100 = range · 0:100:10 = range with step · random 50 · mixes like 1,2,10:20,random 5';

module.exports = { parseSeeds, describe, HELP, MAX_COUNT };

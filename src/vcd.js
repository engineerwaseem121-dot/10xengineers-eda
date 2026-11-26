'use strict';
/* Value Change Dump (IEEE 1364) parser. Returns hierarchy metadata + per-id change lists. */

const UNIT_EXP = { s: 0, ms: -3, us: -6, ns: -9, ps: -12, fs: -15 };

function parseVcd(text) {
  const endDef = text.indexOf('$enddefinitions');
  if (endDef < 0) throw new Error('Not a valid VCD file ($enddefinitions not found).');
  const toks = text.slice(0, endDef).split(/\s+/).filter(Boolean);
  const root = { name: '', type: 'root', scopes: [], vars: [] };
  const stack = [root];
  const ids = Object.create(null);
  const timescale = { mult: 1, unit: 'ns', exp: -9 };
  let varCount = 0;

  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk === '$timescale') {
      let s = '';
      i++;
      while (i < toks.length && toks[i] !== '$end') s += toks[i++];
      const m = /^(\d+)([munpf]?s)$/.exec(s);
      if (m) { timescale.mult = +m[1]; timescale.unit = m[2]; timescale.exp = UNIT_EXP[m[2]]; }
    } else if (tk === '$scope') {
      const sc = { name: toks[i + 2] || '?', type: toks[i + 1] || 'module', scopes: [], vars: [] };
      stack[stack.length - 1].scopes.push(sc);
      stack.push(sc);
      while (i < toks.length && toks[i] !== '$end') i++;
    } else if (tk === '$upscope') {
      if (stack.length > 1) stack.pop();
      while (i < toks.length && toks[i] !== '$end') i++;
    } else if (tk === '$var') {
      const parts = [];
      i++;
      while (i < toks.length && toks[i] !== '$end') parts.push(toks[i++]);
      const [type, size, id, ...ref] = parts;
      if (!id) continue;
      const name = ref.join('');
      const width = parseInt(size, 10) || 1;
      const scopePath = stack.slice(1).map(s => s.name).join('.');
      stack[stack.length - 1].vars.push({ name, id, width, type, path: scopePath ? scopePath + '.' + name : name });
      if (!ids[id]) ids[id] = { width, type };
      varCount++;
    } else if (tk === '$date' || tk === '$version' || tk === '$comment') {
      while (i < toks.length && toks[i] !== '$end') i++;
    }
  }

  const data = Object.create(null);
  for (const id in ids) data[id] = { t: [], v: [] };

  let pos = text.indexOf('$end', endDef + 15);
  pos = pos < 0 ? text.length : pos + 4;
  const re = /\S+/g;
  re.lastIndex = pos;
  let time = 0, first = null, m;
  while ((m = re.exec(text))) {
    const tk = m[0];
    const c = tk.charCodeAt(0);
    if (c === 35) { // #
      time = Number(tk.slice(1));
      if (first === null) first = time;
      continue;
    }
    if (c === 36) { // $
      if (tk === '$comment') {
        const e = text.indexOf('$end', re.lastIndex);
        re.lastIndex = e < 0 ? text.length : e + 4;
      }
      continue;
    }
    let val, id;
    if (c === 98 || c === 66 || c === 114 || c === 82 || c === 115 || c === 83) { // b B r R s S
      const m2 = re.exec(text);
      if (!m2) break;
      id = m2[0];
      if (c === 98 || c === 66) val = tk.slice(1).toLowerCase();
      else if (c === 114 || c === 82) val = 'r' + tk.slice(1);
      else val = 's' + tk.slice(1);
    } else {
      val = tk[0].toLowerCase();
      id = tk.slice(1);
    }
    const d = data[id];
    if (!d) continue;
    const k = val.charCodeAt(0);
    if (k !== 114 && k !== 115) {
      const w = ids[id].width;
      if (val.length < w) {
        const f = (k === 120 || k === 122) ? val[0] : '0';
        val = f.repeat(w - val.length) + val;
      } else if (val.length > w) val = val.slice(val.length - w);
    }
    const n = d.v.length;
    if (n && d.t[n - 1] === time) {
      d.v[n - 1] = val;
      if (n > 1 && d.v[n - 2] === val) { d.t.pop(); d.v.pop(); }
      continue;
    }
    if (n && d.v[n - 1] === val) continue;
    d.t.push(time);
    d.v.push(val);
  }

  varCount -= regroupBits(root, ids, data);

  const meta = {
    timescale,
    tree: root,
    startTime: first === null ? 0 : first,
    endTime: time,
    varCount,
    idCount: Object.keys(ids).length
  };
  return { meta, data };
}

/**
 * Some simulators (Questa for nets driven through an interface, some gate-level dumps) write a bus as separate
 * 1-bit signals "wr_data[7]" … "wr_data[0]". Put them back together as one bus "wr_data[7:0]", like GTKWave does.
 * Only contiguous runs of 2+ bits with no real bus of the same name in the scope are merged.
 * returns how many signals were removed from the listing (merged bits minus the new buses)
 */
function regroupBits(rootScope, ids, data) {
  let removed = 0, seq = 0;
  const walk = sc => {
    const groups = new Map();
    const names = new Set(sc.vars.map(v => v.name.replace(/\s*\[.*$/, '')));
    for (const v of sc.vars) {
      const m = /^(.+?)\s*\[(\d+)\]$/.exec(v.name);
      if (!m || v.width !== 1) continue;
      if (!groups.has(m[1])) groups.set(m[1], []);
      groups.get(m[1]).push({ v, i: +m[2] });
    }
    for (const [base, bits] of groups) {
      if (bits.length < 2) continue;
      // a real bus/scalar of the same name already exists (e.g. "q" and "q[0]") -> leave alone
      if (sc.vars.some(v => v.name.replace(/\s*\[.*$/, '') === base && !/^\s*\[\d+\]$/.test(v.name.slice(base.length)))) continue;
      bits.sort((a, b) => b.i - a.i);
      const msb = bits[0].i, lsb = bits[bits.length - 1].i;
      if (new Set(bits.map(b => b.i)).size !== bits.length || msb - lsb + 1 !== bits.length) continue;   // gaps / duplicates
      const ds = bits.map(b => data[b.v.id]).filter(Boolean);
      if (ds.length !== bits.length) continue;
      // merge the change lists: one sample per time any bit changes
      const times = [...new Set([].concat(...ds.map(d => d.t)))].sort((a, b) => a - b);
      const ptr = ds.map(() => -1);
      const t = [], val = [];
      for (const tm of times) {
        let s = '';
        for (let k = 0; k < ds.length; k++) {
          const d = ds[k];
          while (ptr[k] + 1 < d.t.length && d.t[ptr[k] + 1] <= tm) ptr[k]++;
          s += ptr[k] < 0 ? 'x' : d.v[ptr[k]];
        }
        if (val.length && val[val.length - 1] === s) continue;
        t.push(tm); val.push(s);
      }
      const id = `#bus${seq++}:${base}`;
      ids[id] = { width: bits.length, type: bits[0].v.type };
      data[id] = { t, v: val };
      const first = sc.vars.indexOf(bits[0].v) >= 0 ? Math.min(...bits.map(b => sc.vars.indexOf(b.v))) : sc.vars.length;
      const scopePath = bits[0].v.path.slice(0, bits[0].v.path.length - bits[0].v.name.length).replace(/\.$/, '');
      const bus = { name: `${base}[${msb}:${lsb}]`, id, width: bits.length, type: bits[0].v.type, path: (scopePath ? scopePath + '.' : '') + `${base}[${msb}:${lsb}]`, bits: bits.map(b => b.v.id) };
      const drop = new Set(bits.map(b => b.v));
      sc.vars = sc.vars.filter(v => !drop.has(v));
      sc.vars.splice(Math.min(first, sc.vars.length), 0, bus);
      removed += bits.length - 1;
      void names;
    }
    sc.scopes.forEach(walk);
  };
  walk(rootScope);
  return removed;
}

module.exports = { parseVcd, regroupBits };

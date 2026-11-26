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

module.exports = { parseVcd };

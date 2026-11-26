'use strict';
/* Module header / port parser (ANSI and non-ANSI) used by the UVM generator. */
const { stripComments } = require('./fsm');

function splitTop(s, sep) {
  const out = [];
  let d = 0, cur = '';
  for (const c of s) {
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    if (c === sep && d === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function matchParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')') { d--; if (d === 0) return i; }
  }
  return -1;
}

function evalExpr(expr, params) {
  let e = String(expr).replace(/\$clog2\s*\(/g, 'clog2(');
  e = e.replace(/[A-Za-z_]\w*/g, id => (id === 'clog2' ? id : (params[id] != null ? '(' + params[id] + ')' : id)));
  e = e.replace(/(\d+)?'[sS]?[dD](\d+)/g, '$2').replace(/(\d+)?'[sS]?[hH]([0-9a-fA-F]+)/g, (m, a, b) => String(parseInt(b, 16))).replace(/(\d+)?'[sS]?[bB]([01]+)/g, (m, a, b) => String(parseInt(b, 2)));
  if (!/^[\d\s+\-*/%()clog2<>]*$/.test(e.replace(/clog2/g, ''))) return null;
  try {
    // eslint-disable-next-line no-new-func
    const v = Function('clog2', '"use strict"; return (' + e.replace(/\*\*/g, '**') + ');')(x => Math.ceil(Math.log2(Math.max(1, x))));
    return Number.isFinite(v) ? Math.trunc(v) : null;
  } catch (err) { return null; }
}

function rangeInfo(range, params) {
  if (!range) return { width: 1, range: '' };
  const m = /\[\s*([^:\]]+)\s*:\s*([^\]]+)\]/.exec(range);
  if (!m) return { width: null, range };
  const a = evalExpr(m[1], params), b = evalExpr(m[2], params);
  return { width: a != null && b != null ? Math.abs(a - b) + 1 : null, range: range.trim() };
}

const DECL_RE = /^\s*(input|output|inout|ref)?\s*(wire|reg|logic|bit|var|tri|integer|int|byte|shortint|longint)?\s*(wire|reg|logic|bit)?\s*(signed|unsigned)?\s*((?:\[[^\]]*\]\s*)*)([A-Za-z_]\w*)\s*((?:\[[^\]]*\]\s*)*)(?:=.*)?$/s;

function parseModules(text) {
  const clean = stripComments(text);
  const mods = [];
  const re = /\bmodule\s+(?:(?:automatic|static)\s+)?([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(clean))) {
    const name = m[1];
    let i = re.lastIndex;
    const params = {}, paramList = [];
    // optional imports before params
    const rest = clean.slice(i);
    let off = 0;
    const imp = /^\s*(?:import\s+[^;]+;\s*)*/.exec(rest);
    if (imp) off += imp[0].length;
    if (/^\s*#\s*\(/.test(rest.slice(off))) {
      const open = i + off + rest.slice(off).indexOf('(');
      const close = matchParen(clean, open);
      let local = false;
      splitTop(clean.slice(open + 1, close), ',').forEach(p => {
        const kw = /^\s*(parameter|localparam)\b/.exec(p);
        if (kw) local = kw[1] === 'localparam';
        const pm = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*=\s*([\s\S]+)$/.exec(p.trim());
        if (pm) {
          const v = evalExpr(pm[2].trim(), params);
          params[pm[1]] = v;
          if (!local) paramList.push({ name: pm[1], value: v != null ? String(v) : pm[2].trim(), expr: pm[2].trim() });
        }
      });
      i = close + 1;
    } else i += off;
    const endIdx = clean.indexOf('endmodule', i);
    const body = clean.slice(i, endIdx < 0 ? clean.length : endIdx);
    // body parameters (localparam / parameter) for width evaluation
    let pr;
    const bpRe = /\b(?:parameter|localparam)\b([^;]*);/g;
    while ((pr = bpRe.exec(body))) {
      splitTop(pr[1], ',').forEach(p => {
        const pm = /([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(p.trim());
        if (pm && params[pm[1]] == null) params[pm[1]] = evalExpr(pm[2], params);
      });
    }
    const ports = [];
    const lp = body.search(/\S/);
    if (body[lp] === '(') {
      const close = matchParen(body, lp);
      const list = body.slice(lp + 1, close);
      const items = splitTop(list, ',').map(s => s.trim()).filter(Boolean);
      const ansi = items.some(s => /^(input|output|inout|ref)\b/.test(s)) || items.some(s => /\./.test(s.split(/\s+/)[0]));
      if (ansi) {
        let last = { dir: 'input', type: 'logic', sign: '', range: '' };
        for (const it of items) {
          const first = it.split(/\s+/)[0];
          const KW = /^(input|output|inout|ref|wire|reg|logic|bit|var|tri|integer|int|byte|shortint|longint|signed|unsigned)$/;
          if (/\./.test(first) || (!KW.test(first) && /^[A-Za-z_][\w.]*\s+[A-Za-z_]\w*\s*$/.test(it))) {
            const parts = it.split(/\s+/);
            ports.push({ dir: 'interface', type: parts[0], name: parts[parts.length - 1], width: null, range: '' });
            continue;
          }
          const d = DECL_RE.exec(it);
          if (!d) continue;
          const explicitDir = !!d[1];
          const dir = d[1] || last.dir;
          const type = d[2] || d[3] || (explicitDir ? 'logic' : last.type);
          const range = d[5] ? d[5].trim() : (explicitDir || d[2] ? '' : last.range);
          const sign = d[4] || (explicitDir ? '' : last.sign);
          last = { dir, type, sign, range };
          const ri = rangeInfo(range, params);
          let width = ri.width;
          if (/^(integer|int)$/.test(type)) width = 32; else if (type === 'byte') width = 8; else if (type === 'shortint') width = 16; else if (type === 'longint') width = 64;
          ports.push({ dir, type, signed: sign === 'signed', name: d[6], range: ri.range, width, unpacked: (d[7] || '').trim() });
        }
      } else {
        const names = items.map(s => s.replace(/\s+/g, ''));
        for (const n of names) {
          const dm = new RegExp('\\b(input|output|inout)\\b\\s*(wire|reg|logic|bit)?\\s*(signed)?\\s*(\\[[^\\]]*\\])?\\s*([^;]*\\b' + n + '\\b[^;]*);').exec(body);
          const ri = rangeInfo(dm && dm[4], params);
          ports.push({ dir: dm ? dm[1] : 'input', type: dm && dm[2] ? dm[2] : 'logic', signed: !!(dm && dm[3]), name: n, range: ri.range, width: dm ? ri.width : 1, unpacked: '' });
        }
      }
    }
    mods.push({ name, params: paramList, paramValues: params, ports });
    re.lastIndex = endIdx < 0 ? clean.length : endIdx;
  }
  return mods;
}

function classify(ports) {
  const isClk = p => p.dir === 'input' && (p.width === 1 || p.width == null) && /^(clk|clock|aclk|pclk|hclk|sclk|i_clk|clk_i|.*_clk|clk_.*)$/i.test(p.name);
  const isRst = p => p.dir === 'input' && (p.width === 1 || p.width == null) && /(rst|reset|clr)/i.test(p.name);
  const clk = ports.find(isClk) || null;
  const rst = ports.find(isRst) || null;
  const activeLow = rst ? /(_n|n|_b|_l|_ni|_nb)$/i.test(rst.name) && !/^(rst|reset|clr)$/i.test(rst.name) : true;
  const data = ports.filter(p => p !== clk && p !== rst && p.dir !== 'interface');
  return { clk, rst, activeLow, inputs: data.filter(p => p.dir === 'input'), outputs: data.filter(p => p.dir === 'output' || p.dir === 'inout'), unsupported: ports.filter(p => p.dir === 'interface') };
}

module.exports = { parseModules, classify, evalExpr };

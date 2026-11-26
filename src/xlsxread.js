'use strict';
/* 10xEngineers EDA — read-only .xlsx reader (no dependencies): zip central directory + inflate + SpreadsheetML.
 * Handles shared strings (files saved by Excel / LibreOffice), inline strings (files we write), numbers, booleans,
 * cached formula results, column widths and merged title rows. Returns plain data for the viewer. */
const zlib = require('zlib');

function unzip(buf) {
  // end of central directory: signature 0x06054b50 within the last 64 KiB
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip / .xlsx file (end of central directory not found)');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    const data = buf.slice(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
    files[name] = { method, data };
    p += 46 + nl + el + cl;
  }
  return name => {
    const f = files[name] || files[Object.keys(files).find(k => k.toLowerCase() === String(name).toLowerCase())];
    if (!f) return null;
    return (f.method === 8 ? zlib.inflateRawSync(f.data) : f.data).toString('utf8');
  };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] != null ? ENT[e] : m));
const attr = (tag, a) => { const m = new RegExp(`\\b${a}="([^"]*)"`).exec(tag); return m ? unesc(m[1]) : null; };
const textOf = xml => unesc((String(xml).match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/^<t\b[^>]*>|<\/t>$/g, '')).join(''));
const colIndex = ref => { const m = /^([A-Z]+)/.exec(ref || ''); let n = 0; if (m) for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const rowIndex = ref => { const m = /(\d+)$/.exec(ref || ''); return m ? +m[1] - 1 : -1; };

/** read an .xlsx buffer -> { sheets: [{ name, rows: [[cell]], widths: [chars], merges: [{r, c, r2, c2}] }] } */
function readXlsx(buf, opts) {
  opts = opts || {};
  const maxRows = opts.maxRows || 50000;
  const get = unzip(buf);
  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('xl/workbook.xml missing: not a spreadsheet');
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  const target = {};
  (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(r => { target[attr(r, 'Id')] = attr(r, 'Target'); });
  const sst = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) (ss.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) || []).forEach(si => sst.push(textOf(si)));
  const sheets = [];
  for (const tag of wb.match(/<sheet\b[^>]*\/?>/g) || []) {
    const name = attr(tag, 'name') || 'Sheet';
    let t = target[attr(tag, 'r:id')] || '';
    t = t.replace(/^\//, '');
    const xml = get(t.startsWith('xl/') ? t : 'xl/' + t.replace(/^\.\.\//, ''));
    if (!xml) { sheets.push({ name, rows: [], widths: [], merges: [], missing: true }); continue; }
    const rows = [];
    let truncated = false;
    const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
    let rm, autoR = 0;
    while ((rm = rowRe.exec(xml))) {
      const rAttr = attr('<x' + (rm[1] || rm[3] || '') + '>', 'r');
      const r = rAttr ? +rAttr - 1 : autoR;
      autoR = r + 1;
      if (r >= maxRows) { truncated = true; break; }
      const cells = [];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm, autoC = 0;
      while ((cm = cellRe.exec(rm[2] || ''))) {
        const head = '<c' + cm[1] + '>', body = cm[2] || '';
        const ref = attr(head, 'r');
        const c = ref ? colIndex(ref) : autoC;
        autoC = c + 1;
        const type = attr(head, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        let val = null;
        if (type === 's') val = v ? sst[+v[1]] : '';
        else if (type === 'inlineStr') val = textOf(body);
        else if (type === 'b') val = v ? (v[1] === '1' ? 'TRUE' : 'FALSE') : '';
        else if (type === 'str' || type === 'e') val = v ? unesc(v[1]) : '';
        else if (v) { const num = Number(v[1]); val = isFinite(num) ? num : unesc(v[1]); }
        if (val != null && val !== '') cells[c] = val;
      }
      rows[r] = cells;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    const widths = [];
    (xml.match(/<col\b[^>]*\/?>/g) || []).forEach(c => { const a = +attr(c, 'min'), b = +attr(c, 'max'), w = +attr(c, 'width'); if (a && w) for (let k = a; k <= Math.min(b || a, a + 200); k++) widths[k - 1] = w; });
    const merges = (xml.match(/<mergeCell\b[^>]*\/?>/g) || []).map(m => { const [a, b] = String(attr(m, 'ref') || '').split(':'); return { r: rowIndex(a), c: colIndex(a), r2: rowIndex(b || a), c2: colIndex(b || a) }; });
    sheets.push({ name, rows, widths, merges, truncated });
  }
  return { sheets };
}

/** cells holding the path of an existing file/folder -> {"sheet:row:col": 1}, so the viewer can link them */
function pathLinks(data, exists) {
  const links = {};
  data.sheets.forEach((s, si) => s.rows.forEach((r, ri) => r.forEach((v, ci) => {
    if (typeof v === 'string' && v.length < 400 && /^([A-Za-z]:[\\/]|\/)/.test(v) && exists(v)) links[si + ':' + ri + ':' + ci] = 1;
  })));
  return links;
}

module.exports = { readXlsx, unzip, pathLinks };

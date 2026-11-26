/* 10xEngineers EDA — Excel viewer webview */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const st = vscode.getState() || {};
  let D = null, links = {}, cur = st.sheet || 0, q = '', sort = {};

  const GOOD = /^(pass|passed|covered|hit|met|ok|ready|equivalent|killed|true|done|yes)$/i;
  const BAD = /^(fail|failed|hole|not covered|critical|error|timeout|survived|unreachable|false|missing)$/i;
  const WARN = /^(partial|warn|warning|not run|skipped|blocked|license|pending|incomplete|n\/a|unmapped|review|close|low)$/i;
  const status = v => (typeof v === 'string' ? (GOOD.test(v.trim()) ? 'ok' : BAD.test(v.trim()) ? 'bad' : WARN.test(v.trim()) ? 'warn' : '') : '');

  /** split a sheet into title lines (above the table), header row and data rows */
  function shape(s) {
    const rows = s.rows;
    const width = Math.max(0, ...rows.map(r => r.length));
    let h = rows.findIndex(r => r.filter(v => v != null && v !== '').length >= Math.max(2, Math.ceil(width * 0.6)) && r.every(v => v == null || typeof v === 'string'));
    if (h < 0) h = 0;
    const titles = rows.slice(0, h).map(r => r.filter(v => v != null && v !== '').join('  ')).filter(Boolean);
    const header = (rows[h] || []).slice();
    for (let c = 0; c < width; c++) if (header[c] == null || header[c] === '') header[c] = String.fromCharCode(65 + (c % 26));
    const data = rows.slice(h + 1).map((r, i) => ({ r, i: h + 1 + i })).filter(x => x.r.some(v => v != null && v !== ''));
    return { titles, header, data, width, h };
  }
  /** two-column sheets (Summary): show as a key/value list */
  const isKV = sh => sh.width === 2 && sh.data.length && sh.data.every(x => x.r.length <= 2);

  function hi(text) {
    const t = esc(text);
    if (!q) return t;
    const i = String(text).toLowerCase().indexOf(q);
    if (i < 0) return t;
    return esc(String(text).slice(0, i)) + '<mark>' + esc(String(text).slice(i, i + q.length)) + '</mark>' + esc(String(text).slice(i + q.length));
  }
  function cell(v, si, ri, ci) {
    if (v == null || v === '') return '<td></td>';
    if (typeof v === 'number') return `<td class="num">${hi(Number.isInteger(v) ? v : +v.toFixed(4))}</td>`;
    const s = status(v);
    if (s) return `<td><span class="pill ${s}">${hi(v)}</span></td>`;
    if (links[`${si}:${ri}:${ci}`]) return `<td class="mono"><a class="path" data-path="${esc(v)}" title="Open">${hi(v)}</a></td>`;
    const mono = /^[A-Z]+-[\w-]+$|^[\w.]+#\d+$|\[|\]|==|'h|^\d+'[bhd]/.test(v) && v.length < 80;
    return `<td class="${mono ? 'mono' + (v.length <= 24 && !/\s/.test(v) ? ' id' : '') : ''}${v.length > 60 || /\n/.test(v) ? ' wrap' : ''}">${hi(v)}</td>`;
  }

  function render() {
    if (!D) return;
    const s = D.data.sheets[cur] || D.data.sheets[0];
    const si = D.data.sheets.indexOf(s);
    const sh = shape(s);
    $('tabs').innerHTML = D.data.sheets.map((x, i) => `<button data-sheet="${i}" class="${i === si ? 'on' : ''}">${esc(x.name)}<span class="n">${Math.max(0, shape(x).data.length)}</span></button>`).join('');
    let rows = sh.data;
    if (q) rows = rows.filter(x => x.r.some(v => v != null && String(v).toLowerCase().includes(q)));
    const so = sort[si];
    if (so) rows = rows.slice().sort((a, b) => {
      const x = a.r[so.c], y = b.r[so.c];
      if (x == null || x === '') return 1; if (y == null || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * so.d;
    });
    let h = sh.titles.length ? `<div class="title"><h1>${esc(sh.titles[0])}</h1>${sh.titles.slice(1).map(t => `<p>${esc(t)}</p>`).join('')}</div>` : '';
    if (s.truncated) h += '<div class="note">Large sheet: only the first 50 000 rows are shown. Open in Excel for the rest.</div>';
    if (isKV(sh) && !q) {
      h += `<table class="kv">${[{ r: sh.header, i: sh.h }].concat(rows).map(x => `<tr>${cell(x.r[0], si, x.i, 0)}${cell(x.r[1], si, x.i, 1)}</tr>`).join('')}</table>`;
    } else if (!rows.length) {
      h += `<div class="empty">${q ? 'No row matches the search.' : 'This sheet is empty.'}</div>`;
    } else {
      const w = c => (s.widths[c] ? ` style="min-width:${Math.min(520, Math.round(s.widths[c] * 6.5))}px"` : '');
      h += `<table><thead><tr><th class="rn">#</th>${sh.header.map((t, c) => `<th data-col="${c}"${w(c)}>${esc(t)}${so && so.c === c ? `<span class="s">${so.d > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead><tbody>`;
      h += rows.slice(0, 5000).map(x => `<tr><td class="rn">${x.i + 1}</td>${sh.header.map((_, c) => cell(x.r[c], si, x.i, c)).join('')}</tr>`).join('');
      h += '</tbody></table>';
      if (rows.length > 5000) h += `<div class="note">Showing 5 000 of ${rows.length} rows: search to narrow down.</div>`;
    }
    $('main').innerHTML = h;
    $('count').textContent = q ? `${rows.length} of ${sh.data.length}` : `${sh.data.length} row(s)`;
    vscode.setState({ sheet: si });
    render.visible = { sh, rows };
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-sheet],[data-col],a.path');
    if (!t) return;
    if (t.dataset.sheet != null) { cur = +t.dataset.sheet; render(); $('main').scrollTop = 0; }
    else if (t.dataset.col != null) { const c = +t.dataset.col, o = sort[cur]; sort[cur] = { c, d: o && o.c === c ? -o.d : 1 }; render(); }
    else if (t.dataset.path) vscode.postMessage({ type: 'open', path: t.dataset.path });
  });
  $('q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(); });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); }
    if (e.key === 'Escape' && document.activeElement === $('q')) { $('q').value = ''; q = ''; render(); }
  });
  $('bExcel').onclick = () => vscode.postMessage({ type: 'excel' });
  $('bReveal').onclick = () => vscode.postMessage({ type: 'reveal' });
  $('bCopy').onclick = () => {
    const v = render.visible; if (!v) return;
    const tsv = [v.sh.header].concat(v.rows.map(x => x.r)).map(r => v.sh.header.map((_, c) => (r[c] == null ? '' : String(r[c]).replace(/[\t\n]/g, ' '))).join('\t')).join('\n');
    vscode.postMessage({ type: 'copy', text: tsv, rows: v.rows.length });
  };
  window.addEventListener('message', ev => {
    const m = ev.data;
    if (m.type === 'data') { D = m; links = m.links || {}; $('file').textContent = m.file; if (cur >= m.data.sheets.length) cur = 0; render(); }
    if (m.type === 'error') $('main').innerHTML = `<div class="empty">Could not read this workbook: ${esc(m.message)}</div>`;
  });
  vscode.postMessage({ type: 'ready' });
})();

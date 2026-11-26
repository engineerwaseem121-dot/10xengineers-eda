/* 10xEngineers EDA - waveform viewer webview */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const ROW_H = 24;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let meta = null, fileName = '';
  let fsms = [];
  const fsmByKey = new Map();
  const allVars = new Map();     // path -> var
  let rows = [];                 // {path,id,name,scope,width,type,radix,fsm}
  let cache = Object.create(null);
  const pending = new Set();
  let view = { start: 0, end: 1 };
  let cursor = null, sel = -1;
  let markers = [];              // named markers {id,name,t,color}
  let markerSeq = 1;
  let fsmRowPath = null, fsmApi = null, fsmApiKey = null, covCache = new Map();
  let drag = null;
  let colors = {};
  const WT = window.WaveTools;
  let decoders = [];             // {id, proto, map:{role:path}, params, label, tx:[]}
  let decSeq = 1;
  let logEntries = [];           // cocotb / simulator log lines {t, level, text, line}
  let searchHits = [], searchIdx = -1;
  let activeTab = 'markers';

  /* ---------------------------------------------------------------- settings (tenxDebug.wave.*) */
  const DEFAULT_SETTINGS = {
    display: { defaultTraceStyle: { color: '', fill: 0.2, radix: 'hex', renderer: 'bus', strokeWidth: 1.5 }, disableGpu: false },
    keyboard: { addSignal: 'a', reload: 'r', zoomAmount: 2, zoomStart: 'Home', zoomEnd: 'End', zoomFit: 'f', zoomIn: '=', zoomOut: '-', zoomTarget: 'cursor' },
    mouse: { reverseScrolling: false, zoomAmount: 1.25, zoomTarget: 'mouse' },
    theme: { palette: ['#22c55e', '#38bdf8', '#f472b6', '#facc15', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171'], minContrast: 3 }
  };
  let S = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  function mergeSettings(s) {
    const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (s) for (const g of Object.keys(out)) if (s[g] && typeof s[g] === 'object') {
      for (const k of Object.keys(s[g])) {
        const v = s[g][k];
        if (v && typeof v === 'object' && !Array.isArray(v) && out[g][k] && typeof out[g][k] === 'object') Object.assign(out[g][k], v); else if (v !== undefined && v !== null && v !== '') out[g][k] = v;
      }
    }
    const st = out.display.defaultTraceStyle;
    st.strokeWidth = Math.max(0.5, Math.round((Number(st.strokeWidth) || 1.5) * 2) / 2);   // multiples of 0.5px
    st.fill = Math.max(0, Math.min(1, Number(st.fill)));                                   // 0 disables fill
    if (st.radix === 'dec') st.radix = 'unsigned';
    if (!Array.isArray(out.theme.palette) || !out.theme.palette.length) out.theme.palette = DEFAULT_SETTINGS.theme.palette;
    return out;
  }
  /** "ctrl+shift+f" style binding → matches keydown */
  function keyMatch(e, binding) {
    if (!binding) return false;
    const parts = String(binding).toLowerCase().split('+').map(s => s.trim());
    let key = parts.pop();
    if (key === '' ) key = '+';
    const need = { ctrl: parts.includes('ctrl') || parts.includes('cmd') || parts.includes('meta'), shift: parts.includes('shift'), alt: parts.includes('alt') };
    if (need.ctrl !== (e.ctrlKey || e.metaKey) || need.alt !== e.altKey) return false;
    if (need.shift && !e.shiftKey) return false;
    const k = e.key.toLowerCase();
    return k === key || (key === 'plus' && k === '+') || (key === 'space' && k === ' ');
  }
  function hexToRgba(c, a) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
    if (!m) return c;
    let h = m[1]; if (h.length === 3) h = h.split('').map(x => x + x).join('');
    const n = parseInt(h, 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function rowStyle(r) {
    const d = S.display.defaultTraceStyle;
    return {
      color: legible(r.color || d.color || (r.width === 1 ? colors.bit : colors.bus)),
      fill: r.fillA != null ? r.fillA : d.fill,
      renderer: r.renderer || (r.width === 1 ? 'line' : (d.renderer === 'line' ? 'bus' : d.renderer)),
      sw: r.strokeWidth || d.strokeWidth
    };
  }

  const canvas = $('wave'), ctx = canvas.getContext('2d');
  const ruler = $('ruler'), rctx = ruler.getContext('2d');
  const scroller = $('scroller'), wavecol = $('wavecol');

  /* ---------------------------------------------------------------- theme */
  function readColors() {
    const cs = getComputedStyle(document.body);
    const g = (v, d) => (cs.getPropertyValue(v) || '').trim() || d;
    colors = {
      bg: g('--vscode-editor-background', '#1e1e1e'),
      fg: g('--vscode-editor-foreground', '#d4d4d4'),
      muted: g('--vscode-descriptionForeground', '#9d9d9d'),
      grid: 'rgba(128,128,128,0.13)',
      sel: g('--vscode-list-inactiveSelectionBackground', 'rgba(55,148,255,0.15)'),
      bit: (S && S.theme.palette[0]) || '#22c55e', bus: (S && S.theme.palette[1]) || '#38bdf8', x: '#ef4444', z: '#f59e0b', real: '#c084fc',
      cursor: '#facc15', marker: '#60a5fa', dec: '#f472b6'
    };
    legible.cache = {};
    // contrast floor: a light/high-contrast theme must not turn a trace into an unreadable line
    for (const k of ['bit', 'bus', 'x', 'z', 'real', 'cursor', 'marker', 'dec']) colors[k] = legible(colors[k]);
  }
  /** colour adjusted to at least tenxDebug.wave.theme.minContrast (default 3:1, WCAG non-text) against the background */
  function legible(c) {
    const min = S && S.theme && S.theme.minContrast != null ? Number(S.theme.minContrast) : 3;
    if (!min || !colors || !colors.bg) return c;
    const key = c + '|' + colors.bg + '|' + min;
    if (!legible.cache) legible.cache = {};
    return legible.cache[key] || (legible.cache[key] = WT.ensureContrast(c, colors.bg, min));
  }
  readColors();
  new MutationObserver(() => { readColors(); redraw(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  /* ---------------------------------------------------------------- time formatting */
  const UNITS = { 0: 's', '-3': 'ms', '-6': 'us', '-9': 'ns', '-12': 'ps', '-15': 'fs' };
  function trimNum(v) { return (+v.toFixed(3)).toString(); }
  function fmtTime(t, ref) {
    if (t == null || !meta) return '-';
    const ts = meta.timescale;
    let e = ts.exp, v = t * ts.mult, r = Math.abs((ref == null ? t : ref) * ts.mult);
    while (r >= 1000 && e < 0) { v /= 1000; r /= 1000; e += 3; }
    return trimNum(v) + ' ' + UNITS[e];
  }

  /* ---------------------------------------------------------------- values */
  function idxAt(d, t) {
    const a = d.t;
    if (!a.length || a[0] > t) return -1;
    let lo = 0, hi = a.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a[mid] <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }
  const isXZ = raw => /[^01]/.test(raw);
  function fsmOf(row) { return row.fsm ? fsmByKey.get(row.fsm) : null; }
  function fmt(row, raw) {
    if (raw == null) return '';
    const c = raw[0];
    if (c === 'r') return trimNum(parseFloat(raw.slice(1)));
    if (c === 's') return raw.slice(1);
    if (raw.length === 1) return raw;
    const f = fsmOf(row);
    if (isXZ(raw)) {
      if (/^x+$/.test(raw)) return 'x';
      if (/^z+$/.test(raw)) return 'z';
      if (row.radix === 'bin') return raw;
      if (row.radix === 'hex') {
        let s = '';
        const pad = (4 - raw.length % 4) % 4;
        const p = '0'.repeat(pad) + raw;
        for (let i = 0; i < p.length; i += 4) { const nib = p.slice(i, i + 4); s += /x/.test(nib) ? 'x' : /z/.test(nib) ? 'z' : parseInt(nib, 2).toString(16); }
        return s;
      }
      return 'x';
    }
    if (f) { const n = f.byValue.get(parseInt(raw, 2)); return n || '?' + BigInt('0b' + raw).toString(16); }
    switch (row.radix) {
      case 'bin': return raw;
      case 'oct': return BigInt('0b' + raw).toString(8);
      case 'dec': case 'unsigned': return BigInt('0b' + raw).toString(10);
      case 'float': { const fv = WT && WT.toFloat(raw); return fv == null ? '(float needs 16/32/64 bits)' : trimNum(fv); }
      case 'utf8': return '"' + (WT ? WT.toUtf8(raw) : '') + '"';
      case 'signed': { const v = BigInt('0b' + raw); return (raw[0] === '1' ? v - (1n << BigInt(raw.length)) : v).toString(10); }
      case 'ascii': {
        let s = '';
        const p = '0'.repeat((8 - raw.length % 8) % 8) + raw;
        for (let i = 0; i < p.length; i += 8) { const ch = parseInt(p.slice(i, i + 8), 2); s += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : (ch ? '.' : ''); }
        return '"' + s + '"';
      }
      default: return BigInt('0b' + raw).toString(16);
    }
  }
  function stateColor(f, name) {
    const i = f.stateIndex.get(name);
    if (i == null) return null;
    const h = (i * 137.5 + 20) % 360;
    return `hsla(${h},70%,55%,`;
  }

  /* ---------------------------------------------------------------- messages */
  window.addEventListener('message', ev => {
    const m = ev.data;
    switch (m.type) {
      case 'init':
        meta = m.meta; fileName = m.fileName || '';
        S = mergeSettings(m.settings); readColors();
        if (S.display.disableGpu) canvas.dataset.gpu = 'off';
        setFsms(m.fsms);
        indexVars();
        buildTree();
        applyLayout(m.layout);
        break;
      case 'reload':
        meta = m.meta;
        cache = Object.create(null);
        covCache.clear();
        indexVars();
        buildTree();
        requestMissing();
        rows = rows.filter(r => r.dec || allVars.has(r.path)).map(r => r.dec ? r : Object.assign(r, { id: allVars.get(r.path).id }));
        renderRows();
        toast('Reloaded ' + fileName);
        break;
      case 'data':
        for (const d of m.items) { cache[d.id] = d; pending.delete(d.id); }
        covCache.clear();
        recomputeDecoders();
        updateValues(); redraw(); updateFsmPane();
        break;
      case 'fsms':
        setFsms(m.fsms);
        rows.forEach(r => { if (r.fsm && !fsmByKey.has(r.fsm)) r.fsm = autoFsm(allVars.get(r.path) || r); });
        covCache.clear();
        renderRows(); updateFsmPane();
        break;
      case 'settings':
        S = mergeSettings(m.settings); readColors(); renderRows(); redraw();
        break;
      case 'goto':
        if (m.t != null) { cursor = m.t; if (m.span) setView(m.t - m.span / 2, m.t + m.span / 2); else ensureVisible(m.t); afterCursor(); }
        if (m.marker) addMarker(m.t, m.marker);
        break;
      case 'addSignals': {   // from .gtkw import or extension commands: [{path, radix, color}]
        let added = 0;
        (m.signals || []).forEach(s => {
          const bare = p => p.replace(/\s*\[\d+:\d+\]$/, '');
          const v = allVars.get(s.path) || [...allVars.values()].find(x => bare(x.path) === bare(s.path)) || [...allVars.values()].find(x => bare(x.path).endsWith('.' + bare(s.path)));
          if (!v || rows.some(r => r.path === v.path)) return;
          addSignal(v, false);
          const r = rows[sel]; if (s.radix) r.radix = s.radix; if (s.color) r.color = s.color;
          added++;
        });
        (m.markers || []).forEach(mk => addMarker(mk.t, mk.name, true));
        afterAdd(); toast(`Added ${added} signal(s)${m.source ? ' from ' + m.source : ''}`);
        break;
      }
      case 'log':
        logEntries = m.entries || [];
        showTab('log'); renderLog(); redraw();
        toast(`Loaded ${logEntries.length} log line(s) with timestamps`);
        break;
      case 'error':
        $('names').innerHTML = `<div class="empty">⚠ ${esc(m.message)}</div>`;
        break;
      case 'xtraceRtl':
        renderRtlTrace(m);
        break;
    }
  });
  function afterCursor() { updateValues(); redraw(); updateFsmCursor(); postCursor(); renderMarkers(); }
  let curT;
  function postCursor() {
    clearTimeout(curT);
    curT = setTimeout(() => {
      if (cursor == null) return;
      const values = rows.filter(r => !r.dec && cache[r.id]).map(r => { const d = cache[r.id]; const k = idxAt(d, cursor); return { path: r.path, name: r.name, value: k < 0 ? '' : fmt(r, d.v[k]) }; });
      vscode.postMessage({ type: 'cursor', t: cursor, time: fmtTime(cursor), values });
    }, 150);
  }

  function setFsms(list) {
    fsms = list || [];
    fsmByKey.clear();
    fsms.forEach(f => {
      f.byValue = new Map();
      f.stateIndex = new Map();
      f.states.forEach((s, i) => { if (s.value != null && !f.byValue.has(s.value)) f.byValue.set(s.value, s.name); f.stateIndex.set(s.name, i); });
      fsmByKey.set(f.key, f);
    });
  }

  function indexVars() {
    allVars.clear();
    const walk = (sc, prefix) => {
      sc.vars.forEach(v => { v.scope = prefix; allVars.set(v.path, v); });
      sc.scopes.forEach(s => walk(s, prefix ? prefix + '.' + s.name : s.name));
    };
    walk(meta.tree, '');
    $('sideinfo').textContent = `${meta.varCount} signals · ${fmtTime(meta.startTime, meta.endTime)} – ${fmtTime(meta.endTime)} · timescale ${meta.timescale.mult}${meta.timescale.unit}`;
  }

  /* ---------------------------------------------------------------- tree */
  function varHtml(v, showPath) {
    const added = rows.some(r => r.path === v.path) ? ' added' : '';
    return `<div class="var${added}" data-path="${esc(v.path)}" title="${esc(v.path)} (${esc(v.type)}, ${v.width} bit)">${showPath && v.scope ? `<span class="p">${esc(v.scope)}.</span>` : ''}${esc(v.name)}${v.width > 1 && !/\[/.test(v.name) ? `<span class="w">[${v.width - 1}:0]</span>` : ''}</div>`;
  }
  function scopeNode(sc, depth) {
    const d = document.createElement('details');
    if (depth < 2) d.open = true;
    d.innerHTML = `<summary><span class="scopeIcon">◇</span>${esc(sc.name)}<button class="add" title="Add all signals in this scope">+</button></summary><div></div>`;
    const body = d.lastElementChild;
    let filled = false;
    const fill = () => {
      if (filled) return;
      filled = true;
      sc.scopes.forEach(s => body.appendChild(scopeNode(s, depth + 1)));
      body.insertAdjacentHTML('beforeend', sc.vars.map(v => varHtml(v, false)).join(''));
    };
    if (d.open) fill();
    d.addEventListener('toggle', fill);
    d.querySelector('.add').addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      sc.vars.forEach(v => addSignal(v, false));
      afterAdd();
    });
    return d;
  }
  function buildTree() {
    const tree = $('tree');
    const q = $('filter').value.trim().toLowerCase();
    tree.innerHTML = '';
    if (q) {
      const hits = [];
      for (const v of allVars.values()) if (v.path.toLowerCase().includes(q)) { hits.push(v); if (hits.length >= 1000) break; }
      tree.innerHTML = hits.map(v => varHtml(v, true)).join('') || '<div class="empty">No matching signals</div>';
      return;
    }
    meta.tree.scopes.forEach(s => tree.appendChild(scopeNode(s, 0)));
    tree.insertAdjacentHTML('beforeend', meta.tree.vars.map(v => varHtml(v, false)).join(''));
  }
  $('filter').addEventListener('input', buildTree);
  $('tree').addEventListener('click', e => {
    const d = e.target.closest('.var');
    if (!d) return;
    const v = allVars.get(d.dataset.path);
    if (v) { addSignal(v, true); afterAdd(); }
  });

  /* ---------------------------------------------------------------- rows */
  function autoFsm(v) {
    const leaf = v.name.replace(/\s*\[.*\]$/, '').toLowerCase();
    let best = null;
    for (const f of fsms) {
      if (!f.stateVars.some(s => s.toLowerCase() === leaf)) continue;
      const maxV = Math.max(0, ...f.states.map(s => s.value || 0));
      const fits = v.width >= 32 || maxV < Math.pow(2, v.width);
      if (!fits) continue;
      const score = (f.width === v.width ? 2 : 0) + (v.scope && f.module && v.scope.toLowerCase().includes(f.module.toLowerCase()) ? 1 : 0);
      if (!best || score > best.score) best = { f, score };
    }
    return best ? best.f.key : null;
  }
  function addSignal(v, single) {
    if (single && rows.some(r => r.path === v.path)) { selectRow(rows.findIndex(r => r.path === v.path)); return; }
    const row = { path: v.path, id: v.id, name: v.name, scope: v.scope, width: v.width, type: v.type, radix: v.width > 1 ? S.display.defaultTraceStyle.radix : 'bin', fsm: autoFsm(v) };
    const at = sel >= 0 ? sel + 1 : rows.length;
    rows.splice(at, 0, row);
    sel = at;
    if (row.fsm && !fsmRowPath) fsmRowPath = row.path;
  }
  function afterAdd() {
    requestMissing(); renderRows(); buildTreeMarks(); save();
    if (rows.some(r => r.fsm) && $('fsmPane').classList.contains('hidden') && !afterAdd.shown) { afterAdd.shown = true; toggleFsm(true); }
  }
  function buildTreeMarks() {
    const set = new Set(rows.map(r => r.path));
    document.querySelectorAll('#tree .var').forEach(d => d.classList.toggle('added', set.has(d.dataset.path)));
  }
  function requestMissing() {
    const ids = [...new Set(rows.filter(r => !r.dec).map(r => r.id).concat(decoders.flatMap(dc => Object.values(dc.map).map(p => (allVars.get(p) || {}).id).filter(Boolean))))].filter(id => !cache[id] && !pending.has(id));
    if (!ids.length) return;
    ids.forEach(id => pending.add(id));
    vscode.postMessage({ type: 'request', ids });
  }
  function selectRow(i) {
    sel = Math.max(-1, Math.min(rows.length - 1, i));
    document.querySelectorAll('#names .row, #values .row').forEach(d => d.classList.toggle('sel', +d.dataset.i === sel));
    if (sel >= 0) {
      const top = sel * ROW_H;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (top + ROW_H > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + ROW_H - scroller.clientHeight;
      if (rows[sel].fsm) { fsmRowPath = rows[sel].path; updateFsmPane(); }
      if (!rows[sel].dec) { clearTimeout(selectRow.t); const p = rows[sel].path; selectRow.t = setTimeout(() => vscode.postMessage({ type: 'selected', path: p }), 200); }
    }
    redraw();
  }

  function renderRows() {
    const names = $('names'), values = $('values');
    if (!rows.length) {
      names.innerHTML = `<div class="empty">Click signals in the browser on the left to add them.<br><br><b>Tips</b><br>Ctrl+wheel: zoom · Shift+wheel: pan<br>Drag on waves: zoom to region<br>Click: cursor · Shift+click: marker<br>←/→: jump to edges · Right-click a signal for radix / FSM</div>`;
      values.innerHTML = '';
    } else {
      names.innerHTML = rows.map((r, i) => {
        const f = fsmOf(r);
        const st = rowStyle(r);
        const tag = r.dec ? `<span class="tag dec">⇄ ${esc(r.dec.proto)}</span>` : f ? `<span class="tag fsm" title="Decoded with FSM ${esc(f.id)}">◆ FSM</span>` : (r.width > 1 ? `<span class="tag">${r.radix}${st.renderer === 'step' || st.renderer === 'linear' ? ' ∿' : ''}</span>` : '');
        return `<div class="row${i === sel ? ' sel' : ''}" draggable="true" data-i="${i}" title="${esc(r.path)}"><span class="sw" style="background:${esc(r.dec ? colors.dec : st.color)}"></span><span class="nm">${r.scope ? `<span class="scope">${esc(r.scope.split('.').pop())}.</span>` : ''}${esc(r.name)}</span>${tag}</div>`;
      }).join('');
      values.innerHTML = rows.map((r, i) => `<div class="row${i === sel ? ' sel' : ''}" data-i="${i}"></div>`).join('');
    }
    updateValues();
    resize();
    updateFsmSelect();
  }

  function updateValues() {
    const vals = $('values').children;
    rows.forEach((r, i) => {
      const el = vals[i];
      if (!el) return;
      if (r.dec) {
        const dc = decoders.find(x => x.id === r.dec.id);
        const tx = dc && cursor != null ? dc.tx.filter(x => x.t <= cursor).pop() : null;
        el.textContent = tx ? `${tx.kind} ${tx.addr || ''} ${tx.data || ''}`.trim() : '';
        el.title = el.textContent; return;
      }
      const d = cache[r.id];
      if (!d) { el.textContent = '…'; return; }
      if (cursor == null) { el.textContent = ''; return; }
      const k = idxAt(d, cursor);
      el.textContent = k < 0 ? '' : fmt(r, d.v[k]);
      el.title = el.textContent;
    });
    const ro = $('readout');
    let s = `<span class="c">Cursor</span> <b>${fmtTime(cursor)}</b>`;
    const mk = nearestMarker();
    if (mk) s += ` &nbsp; <span class="m">${esc(mk.name)}</span> <b>${fmtTime(mk.t)}</b> &nbsp; Δ <b>${cursor != null ? fmtTime(Math.abs(cursor - mk.t)) : '-'}</b>`;
    if (markers.length > 1) s += ` &nbsp; <span>${markers.length} markers</span>`;
    s += ` &nbsp; <span>View ${fmtTime(view.start, view.end)} – ${fmtTime(view.end)}</span>`;
    ro.innerHTML = s;
  }

  // names column interactions
  $('names').addEventListener('mousedown', e => {
    const d = e.target.closest('.row');
    if (d) selectRow(+d.dataset.i);
  });
  $('names').addEventListener('contextmenu', e => {
    const d = e.target.closest('.row');
    if (!d) return;
    e.preventDefault();
    selectRow(+d.dataset.i);
    showMenu(e.clientX, e.clientY, +d.dataset.i);
  });
  let dragFrom = -1;
  $('names').addEventListener('dragstart', e => { const d = e.target.closest('.row'); if (d) { dragFrom = +d.dataset.i; e.dataTransfer.effectAllowed = 'move'; } });
  $('names').addEventListener('dragover', e => {
    const d = e.target.closest('.row');
    if (!d || dragFrom < 0) return;
    e.preventDefault();
    document.querySelectorAll('#names .row.drop').forEach(x => x.classList.remove('drop'));
    d.classList.add('drop');
  });
  $('names').addEventListener('drop', e => {
    const d = e.target.closest('.row');
    if (!d || dragFrom < 0) return;
    e.preventDefault();
    const to = +d.dataset.i;
    const [r] = rows.splice(dragFrom, 1);
    rows.splice(to, 0, r);
    sel = to; dragFrom = -1;
    renderRows(); save();
  });
  $('names').addEventListener('dragend', () => { dragFrom = -1; document.querySelectorAll('#names .row.drop').forEach(x => x.classList.remove('drop')); });

  /* ---------------------------------------------------------------- context menu */
  function showMenu(x, y, i) {
    const r = rows[i];
    const m = $('ctxmenu');
    const items = [];
    if (r.width > 1 && !r.dec) {
      items.push(['hd', 'Radix']);
      [['hex', 'Hexadecimal'], ['bin', 'Binary'], ['unsigned', 'Unsigned decimal'], ['signed', 'Signed decimal'], ['oct', 'Octal'], ['ascii', 'ASCII'], ['utf8', 'UTF-8'], ['float', 'Float (IEEE 16/32/64)']]
        .forEach(([k, l]) => items.push(['mi', l, () => { r.radix = k; r.fsm = null; }, (r.radix === k || (k === 'unsigned' && r.radix === 'dec')) && !r.fsm]));
      items.push(['sp']); items.push(['hd', 'Renderer']);
      [['bus', 'Bus (values in boxes)'], ['step', 'Analog: step'], ['linear', 'Analog: linear']]
        .forEach(([k, l]) => items.push(['mi', l, () => { r.renderer = k; }, rowStyle(r).renderer === k]));
    }
    if (!r.dec) {
      items.push(['sp']); items.push(['hd', 'Color']);
      items.push(['mi', 'Default', () => { r.color = null; }, !r.color]);
      S.theme.palette.forEach((c, k) => items.push(['mi', `● Palette ${k + 1}  ${c}`, () => { r.color = c; }, r.color === c]));
      items.push(['hd', 'Stroke / fill']);
      [0.5, 1, 1.5, 2, 3].forEach(w => items.push(['mi', `Stroke ${w}px`, () => { r.strokeWidth = w; }, rowStyle(r).sw === w]));
      items.push(['mi', 'Fill off', () => { r.fillA = 0; }, rowStyle(r).fill === 0]);
      items.push(['mi', 'Fill on', () => { r.fillA = 0.25; }, rowStyle(r).fill > 0]);
      items.push(['sp']);
      items.push(['mi', 'X-trace this signal at cursor', () => { showTab('xtrace'); runXtrace(i); }]);
      items.push(['mi', 'X-trace through RTL drivers', () => { showTab('xtrace'); runXtrace(i); rtlTrace(i); }]);
      items.push(['mi', 'Go to declaration in RTL', () => vscode.postMessage({ type: 'revealDecl', path: r.path })]);
      items.push(['mi', 'Search: rising edge of this signal', () => { showTab('search'); $('srchExpr').value = `${r.name.replace(/\s*\[.*$/, '')} == 1`; runSearch(); }]);
    }
    if (!r.dec && (r.width > 1 || fsms.length)) {
      items.push(['sp']); items.push(['hd', 'Decode as FSM state']);
      items.push(['mi', 'None', () => { r.fsm = null; }, !r.fsm]);
      fsms.forEach(f => items.push(['mi', `${f.module ? f.module + '.' : ''}${f.name}  (${f.fileName})`, () => { r.fsm = f.key; fsmRowPath = r.path; toggleFsm(true); }, r.fsm === f.key]));
      if (r.fsm) items.push(['mi', '◆ Show in FSM panel', () => { fsmRowPath = r.path; toggleFsm(true); }]);
      if (r.fsm) items.push(['mi', 'Open FSM source', () => { const f = fsmOf(r); vscode.postMessage({ type: 'openSource', file: f.file, line: f.line }); }]);
    }
    items.push(['sp']);
    items.push(['mi', 'Move to top', () => { rows.splice(i, 1); rows.unshift(r); sel = 0; }]);
    items.push(['mi', 'Move to bottom', () => { rows.splice(i, 1); rows.push(r); sel = rows.length - 1; }]);
    items.push(['mi', 'Remove  (Del)', () => { removeRow(i); }]);
    m.innerHTML = items.map((it, k) => it[0] === 'sp' ? '<div class="sp"></div>' : it[0] === 'hd' ? `<div class="hd">${esc(it[1])}</div>` : `<div class="mi${it[3] ? ' checked' : ''}" data-k="${k}">${/^● /.test(it[1]) ? `<span class="sw" style="background:${esc(it[1].split(/\s+/).pop())}"></span>` : ''}${esc(it[1])}</div>`).join('');
    m.classList.remove('hidden');
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.min(x, window.innerWidth - w - 4) + 'px';
    m.style.top = Math.min(y, window.innerHeight - h - 4) + 'px';
    m.onclick = e => {
      const d = e.target.closest('.mi');
      if (!d) return;
      items[+d.dataset.k][2]();
      hideMenu();
      covCache.clear();
      renderRows(); redraw(); updateFsmPane(); save();
    };
  }
  function hideMenu() { $('ctxmenu').classList.add('hidden'); }
  window.addEventListener('mousedown', e => { if (!e.target.closest('#ctxmenu')) hideMenu(); });
  window.addEventListener('blur', hideMenu);

  function removeRow(i) {
    if (i < 0 || i >= rows.length) return;
    rows.splice(i, 1);
    if (sel >= rows.length) sel = rows.length - 1;
    renderRows(); buildTreeMarks(); redraw(); updateFsmPane(); save();
  }

  /* ---------------------------------------------------------------- drawing */
  let rafPending = false;
  function redraw() { if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; draw(); }); } }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    wavecol.style.height = Math.max(rows.length * ROW_H, scroller.clientHeight) + 'px';
    const w = wavecol.clientWidth, h = scroller.clientHeight;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
    ruler.width = Math.max(1, ruler.clientWidth * dpr); ruler.height = Math.max(1, ruler.clientHeight * dpr);
    redraw();
  }
  window.addEventListener('resize', resize);
  scroller.addEventListener('scroll', () => { canvas.style.top = scroller.scrollTop + 'px'; redraw(); });

  function tickStep(span, px) {
    const raw = span * 110 / Math.max(px, 1);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
  }

  function draw() {
    if (!meta) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr, H = canvas.height / dpr;
    const span = view.end - view.start || 1;
    const X = t => (t - view.start) * W / span;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);

    // grid
    const step = tickStep(span, W);
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) { const x = Math.round(X(t)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    ctx.stroke();

    const top = scroller.scrollTop;
    const first = Math.max(0, Math.floor(top / ROW_H)), last = Math.min(rows.length - 1, Math.floor((top + H) / ROW_H));
    ctx.font = '11px ' + (getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family') || 'monospace');
    ctx.textBaseline = 'middle';
    for (let i = first; i <= last; i++) {
      const y = i * ROW_H - top;
      if (i === sel) { ctx.fillStyle = colors.sel; ctx.fillRect(0, y, W, ROW_H); }
      drawRow(rows[i], y, W, X);
    }
    // end-of-sim shade
    const xe = X(meta.endTime);
    if (xe < W) { ctx.fillStyle = 'rgba(128,128,128,0.08)'; ctx.fillRect(Math.max(0, xe), 0, W - xe, H); }

    // log entries (cocotb / $display with time) as faint ticks
    if (logEntries.length) {
      for (const le of logEntries) {
        if (le.t < view.start || le.t > view.end) continue;
        const x = Math.round(X(le.t)) + 0.5;
        ctx.strokeStyle = le.level === 'ERROR' || le.level === 'FATAL' || le.level === 'CRITICAL' ? 'rgba(239,68,68,0.5)' : le.level === 'WARNING' ? 'rgba(245,158,11,0.4)' : 'rgba(148,163,184,0.25)';
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
    }
    searchHits.forEach((t, k) => { if (t >= view.start && t <= view.end) { ctx.fillStyle = k === searchIdx ? 'rgba(244,114,182,0.9)' : 'rgba(244,114,182,0.45)'; ctx.fillRect(Math.round(X(t)) - 1, 0, 2, 6); } });
    for (const mk of markers) line(X(mk.t), H, mk.color || colors.marker, [4, 3]);
    if (cursor != null) line(X(cursor), H, colors.cursor, []);
    if (drag && drag.moved) {
      const a = Math.min(drag.x0, drag.x1), b = Math.max(drag.x0, drag.x1);
      ctx.fillStyle = 'rgba(56,189,248,0.15)'; ctx.fillRect(a, 0, b - a, H);
      ctx.strokeStyle = '#38bdf8'; ctx.strokeRect(a + 0.5, 0.5, b - a, H - 1);
    }
    drawRuler(step, X);
  }

  function line(x, H, color, dash) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H); ctx.stroke(); ctx.restore();
  }

  function drawRuler(step, X) {
    const dpr = window.devicePixelRatio || 1;
    const W = ruler.width / dpr, H = ruler.height / dpr;
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rctx.fillStyle = colors.bg; rctx.fillRect(0, 0, W, H);
    rctx.strokeStyle = colors.muted; rctx.fillStyle = colors.muted;
    rctx.font = '10px sans-serif'; rctx.textBaseline = 'top';
    rctx.beginPath();
    for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) {
      const x = Math.round(X(t)) + 0.5;
      rctx.moveTo(x, H - 7); rctx.lineTo(x, H);
      rctx.fillText(fmtTime(t, view.end), x + 3, 4);
      for (let k = 1; k < 5; k++) { const xs = Math.round(X(t + step * k / 5)) + 0.5; rctx.moveTo(xs, H - 3); rctx.lineTo(xs, H); }
    }
    rctx.stroke();
    const mark = (t, c, label) => {
      if (t == null) return;
      const x = X(t);
      if (x < 0 || x > W) return;
      rctx.fillStyle = c; rctx.beginPath(); rctx.moveTo(x - 5, H - 8); rctx.lineTo(x + 5, H - 8); rctx.lineTo(x, H); rctx.fill();
      if (label) {
        rctx.font = 'bold 10px sans-serif';
        const w = rctx.measureText(label).width + 6;
        rctx.fillStyle = c; rctx.fillRect(x + 2, 1, w, 12);
        rctx.fillStyle = '#111'; rctx.fillText(label, x + 5, 2);
      }
    };
    markers.forEach(mk => mark(mk.t, mk.color || colors.marker, mk.name)); mark(cursor, colors.cursor);
  }

  function drawDecRow(row, y, W, X) {
    const dc = decoders.find(x => x.id === row.dec.id);
    const yT = y + 4, yB = y + ROW_H - 4, yM = y + ROW_H / 2;
    if (!dc) return;
    let lastX = -1e9;
    for (const tx of dc.tx) {
      if (tx.t1 < view.start || tx.t > view.end) continue;
      const x0 = X(tx.t), x1 = Math.max(X(tx.t1), x0 + 4);
      if (x1 - lastX < 1) continue;
      lastX = x1;
      ctx.fillStyle = tx.error ? 'rgba(239,68,68,0.3)' : hexToRgba(colors.dec, 0.22);
      ctx.strokeStyle = tx.error ? colors.x : colors.dec; ctx.lineWidth = 1;
      ctx.fillRect(x0, yT, x1 - x0, yB - yT); ctx.strokeRect(x0 + 0.5, yT + 0.5, x1 - x0 - 1, yB - yT - 1);
      const s = `${tx.kind}${tx.addr ? ' @' + tx.addr : ''}${tx.data ? ' ' + tx.data : ''}`;
      const avail = Math.min(x1, W) - Math.max(x0, 0) - 6;
      if (avail > 12) {
        ctx.fillStyle = colors.fg;
        let t = s;
        if (ctx.measureText(t).width > avail) t = tx.kind[0] + (tx.addr ? ' @' + tx.addr : (tx.data ? ' ' + tx.data : ''));   // short form: "W @0x14"
        while (t.length > 1 && ctx.measureText(t).width > avail) t = t.slice(0, -1);
        ctx.fillText(t, Math.max(x0, 0) + 3, yM + 0.5);
      }
    }
  }

  /** analog renderer: step / linear plot scaled to the visible min..max */
  function drawAnalog(row, d, y, W, X, st) {
    const yT = y + 3, yB = y + ROW_H - 3;
    const n = d.t.length;
    const val = raw => { if (raw[0] === 'r') return parseFloat(raw.slice(1)); if (isXZ(raw)) return null; if (row.radix === 'signed') { const v = Number(BigInt('0b' + raw)); return raw[0] === '1' ? v - Math.pow(2, raw.length) : v; } if (row.radix === 'float' && WT) return WT.toFloat(raw); return Number(BigInt('0b' + raw)); };
    let k0 = Math.max(0, idxAt(d, view.start)), k1 = k0;
    let lo = Infinity, hi = -Infinity;
    for (k1 = k0; k1 < n && d.t[k1] <= view.end; k1++) { const v = val(d.v[k1]); if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (!isFinite(lo)) return;
    if (hi === lo) { hi += 1; lo -= 1; }
    const Y = v => yB - (v - lo) / (hi - lo) * (yB - yT);
    const tEnd = Math.max(meta.endTime, d.t[n - 1]);
    if (st.fill > 0) {
      ctx.beginPath(); let started = false, px = null;
      for (let k = k0; k < Math.min(n, k1 + 1); k++) {
        const v = val(d.v[k]); if (v == null) continue;
        const x = Math.max(-2, X(d.t[k]));
        if (!started) { ctx.moveTo(x, yB); ctx.lineTo(x, Y(v)); started = true; } else if (st.renderer === 'step') ctx.lineTo(x, Y(px)), ctx.lineTo(x, Y(v)); else ctx.lineTo(x, Y(v));
        px = v;
      }
      if (started) { const xe = Math.min(W + 2, X(k1 < n ? d.t[k1] : tEnd)); ctx.lineTo(xe, Y(px)); ctx.lineTo(xe, yB); ctx.closePath(); ctx.fillStyle = hexToRgba(st.color, st.fill); ctx.fill(); }
    }
    ctx.beginPath(); ctx.strokeStyle = st.color; ctx.lineWidth = st.sw;
    let started = false, pv = null;
    for (let k = k0; k < Math.min(n, k1 + 1); k++) {
      const v = val(d.v[k]);
      const x = Math.max(-2, Math.min(W + 2, X(d.t[k])));
      if (v == null) { started = false; ctx.fillStyle = 'rgba(239,68,68,0.2)'; ctx.fillRect(x, yT, Math.max(2, X(k + 1 < n ? d.t[k + 1] : tEnd) - x), yB - yT); continue; }
      if (!started) { ctx.moveTo(x, Y(v)); started = true; }
      else if (st.renderer === 'step') { ctx.lineTo(x, Y(pv)); ctx.lineTo(x, Y(v)); }
      else ctx.lineTo(x, Y(v));
      pv = v;
    }
    if (started) ctx.lineTo(Math.min(W + 2, X(k1 < n ? d.t[k1] : tEnd)), Y(pv));
    ctx.stroke();
    ctx.fillStyle = colors.muted; ctx.font = '9px sans-serif';
    ctx.fillText(trimNum(hi), 2, yT + 4); ctx.fillText(trimNum(lo), 2, yB - 3);
    ctx.font = '11px ' + (getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family') || 'monospace');
  }

  function drawRow(row, y, W, X) {
    if (row.dec) return drawDecRow(row, y, W, X);
    const d = cache[row.id];
    const yT = y + 4, yB = y + ROW_H - 4, yM = y + ROW_H / 2;
    if (!d) { ctx.fillStyle = colors.muted; ctx.fillText('loading…', 6, yM); return; }
    const n = d.t.length;
    if (!n) return;
    const f = fsmOf(row);
    const st = rowStyle(row);
    const first = d.v[0][0];
    const isReal = first === 'r', isStr = first === 's';
    const isBit = row.width === 1 && !isReal && !isStr;
    if (!isBit && !isStr && !f && (st.renderer === 'step' || st.renderer === 'linear' || (isReal && !row.renderer && st.renderer !== 'bus'))) return drawAnalog(row, d, y, W, X, st);
    let k = Math.max(0, idxAt(d, view.start));
    const tEnd = Math.max(meta.endTime, d.t[n - 1]);
    let denseFrom = null;

    const flushDense = (x) => {
      if (denseFrom == null) return;
      ctx.fillStyle = st.color;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(denseFrom, yT, Math.max(1, x - denseFrom), yB - yT);
      ctx.globalAlpha = 1;
      denseFrom = null;
    };

    for (; k < n && d.t[k] <= view.end; k++) {
      const x0 = X(d.t[k]);
      const x1 = X(k + 1 < n ? d.t[k + 1] : tEnd);
      if (x1 < 0) continue;
      if (x1 - x0 < 1.2) { if (denseFrom == null) denseFrom = Math.max(0, x0); continue; }
      flushDense(x0);
      const a = Math.max(x0, -2), b = Math.min(x1, W + 2);
      const v = d.v[k];
      if (isBit) {
        const c = v === '1' || v === '0' || v === 'h' || v === 'l' ? st.color : v === 'z' ? colors.z : colors.x;
        ctx.strokeStyle = c; ctx.lineWidth = st.sw;
        if ((v === '1' || v === 'h') && st.fill > 0) { ctx.fillStyle = hexToRgba(st.color, st.fill * 0.6); ctx.fillRect(a, yT, b - a, yB - yT); }
        ctx.beginPath();
        if (v === '1' || v === 'h') { ctx.moveTo(a, yT); ctx.lineTo(b, yT); }
        else if (v === '0' || v === 'l') { ctx.moveTo(a, yB); ctx.lineTo(b, yB); }
        else if (v === 'z') { ctx.moveTo(a, yM); ctx.lineTo(b, yM); }
        else { ctx.fillStyle = 'rgba(239,68,68,0.25)'; ctx.fillRect(a, yT, b - a, yB - yT); ctx.moveTo(a, yM); ctx.lineTo(b, yM); }
        ctx.stroke();
        if (k > 0 && x0 >= 0) { ctx.strokeStyle = st.color; ctx.lineWidth = Math.max(0.5, st.sw - 0.5); ctx.beginPath(); ctx.moveTo(Math.round(x0) + 0.5, yT); ctx.lineTo(Math.round(x0) + 0.5, yB); ctx.stroke(); }
      } else {
        const xz = !isReal && !isStr && isXZ(v);
        const allZ = xz && /^z+$/.test(v);
        let stroke = isReal && !row.color ? colors.real : st.color, fill = st.fill > 0 ? hexToRgba(stroke, st.fill * 0.5) : null;
        const text = fmt(row, v);
        if (xz) { stroke = allZ ? colors.z : colors.x; fill = allZ ? null : 'rgba(239,68,68,0.18)'; }
        else if (f) { const sc = stateColor(f, text); if (sc) { stroke = sc + '1)'; fill = sc + '0.22)'; } else { stroke = colors.x; } }
        const e = Math.min(3, (x1 - x0) / 2);
        if (allZ) {
          ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a, yM); ctx.lineTo(b, yM); ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(x0, yM); ctx.lineTo(x0 + e, yT); ctx.lineTo(x1 - e, yT); ctx.lineTo(x1, yM); ctx.lineTo(x1 - e, yB); ctx.lineTo(x0 + e, yB); ctx.closePath();
          if (fill) { ctx.fillStyle = fill; ctx.fill(); }
          ctx.strokeStyle = stroke; ctx.lineWidth = st.sw; ctx.stroke();
        }
        const avail = Math.min(x1, W) - Math.max(x0, 0) - 8;
        if (avail > 10) {
          ctx.fillStyle = f && !xz ? colors.fg : (xz ? stroke : colors.fg);
          let s = text;
          if (ctx.measureText(s).width > avail) {
            while (s.length > 1 && ctx.measureText(s + '…').width > avail) s = s.slice(0, -1);
            s += '…';
          }
          if (ctx.measureText(s).width <= avail + 2) ctx.fillText(s, Math.max(x0, 0) + 5, yM + 0.5);
        }
      }
    }
    flushDense(Math.min(W, X(k < n ? d.t[k] : tEnd)));
  }

  /* ---------------------------------------------------------------- view control */
  function setView(s, e) {
    if (!meta) return;
    const total = Math.max(1, meta.endTime - meta.startTime);
    let span = Math.max(e - s, 2);
    span = Math.min(span, total * 4);
    if (s < meta.startTime - span * 0.5) s = meta.startTime - span * 0.5;
    if (s + span > meta.endTime + span * 0.5) s = meta.endTime + span * 0.5 - span;
    view = { start: s, end: s + span };
    updateValues(); redraw(); saveSoon();
  }
  function fit() {
    const pad = Math.max(1, (meta.endTime - meta.startTime) * 0.02);
    setView(meta.startTime, meta.endTime + pad);
  }
  function zoomAt(target, mouseT) {
    const span = view.end - view.start;
    if (target === 'mouse' && mouseT != null) return mouseT;
    if (target === 'cursor' && cursor != null && cursor >= view.start && cursor <= view.end) return cursor;
    return view.start + span / 2;
  }
  function zoom(k, at) {
    const span = view.end - view.start;
    if (at == null) at = zoomAt(S.keyboard.zoomTarget, null);
    const ns = span * k;
    setView(at - (at - view.start) * k, at - (at - view.start) * k + ns);
  }
  function center(t) { const span = view.end - view.start; setView(t - span / 2, t + span / 2); }
  function ensureVisible(t) { const span = view.end - view.start; if (t < view.start || t > view.end) center(t); else if (t > view.end - span * 0.05) center(t); }

  function tAt(x) { const W = wavecol.clientWidth; return view.start + x / W * (view.end - view.start); }

  function nextEdge(dir) {
    const r = rows[sel];
    if (!r) return;
    if (r.dec) { // jump between transactions
      const dc = decoders.find(x => x.id === r.dec.id); if (!dc) return;
      const from = cursor != null ? cursor : view.start;
      const tx = dir > 0 ? dc.tx.find(x => x.t > from) : dc.tx.filter(x => x.t < from).pop();
      if (tx) { cursor = tx.t; ensureVisible(tx.t); afterCursor(); }
      return;
    }
    const d = cache[r.id];
    if (!d || !d.t.length) return;
    const from = cursor != null ? cursor : view.start;
    let k = idxAt(d, from);
    let t = null;
    if (dir > 0) { if (k + 1 < d.t.length) t = d.t[k + 1]; }
    else { if (k >= 0 && d.t[k] < from) t = d.t[k]; else if (k > 0) t = d.t[k - 1]; }
    if (t == null) return;
    cursor = t;
    ensureVisible(t);
    afterCursor();
  }

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    drag = { x0: e.clientX - r.left, x1: e.clientX - r.left, y: e.clientY - r.top, moved: false, shift: e.shiftKey };
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    drag.x1 = e.clientX - r.left;
    if (Math.abs(drag.x1 - drag.x0) > 5) drag.moved = true;
    if (drag.moved) redraw();
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const dr = drag; drag = null;
    if (dr.moved) {
      const a = tAt(Math.min(dr.x0, dr.x1)), b = tAt(Math.max(dr.x0, dr.x1));
      setView(a, b);
      return;
    }
    let t = tAt(dr.x0);
    const ri = Math.floor((dr.y + scroller.scrollTop) / ROW_H);
    if (ri >= 0 && ri < rows.length) {
      const d = rows[ri].dec ? null : cache[rows[ri].id];
      if (d && d.t.length) {
        const k = idxAt(d, t);
        const W = wavecol.clientWidth, px = (view.end - view.start) / W;
        const cand = [d.t[k], d.t[k + 1]].filter(v => v != null);
        cand.forEach(c => { if (Math.abs(c - t) < 6 * px) t = c; });
      }
      if (!dr.shift) selectRow(ri);
    }
    t = Math.round(t);
    if (dr.shift) addMarker(t); else cursor = t;
    afterCursor(); saveSoon();
  });
  canvas.addEventListener('dblclick', e => {
    // double-click near a marker renames it
    const r = canvas.getBoundingClientRect();
    const mk = markerNearX(e.clientX - r.left);
    if (mk) renameMarker(mk.id);
  });
  canvas.addEventListener('wheel', e => {
    const rev = S.mouse.reverseScrolling ? -1 : 1;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const amt = Math.max(1.01, Number(S.mouse.zoomAmount) || 1.25);
      zoom((e.deltaY * rev) > 0 ? amt : 1 / amt, zoomAt(S.mouse.zoomTarget, tAt(e.clientX - r.left)));
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      const dlt = (e.shiftKey ? e.deltaY : e.deltaX) * rev;
      const span = view.end - view.start;
      setView(view.start + dlt / wavecol.clientWidth * span, view.end + dlt / wavecol.clientWidth * span);
    }
  }, { passive: false });
  ruler.addEventListener('click', e => {
    const r = ruler.getBoundingClientRect();
    const t = Math.round(tAt(e.clientX - r.left));
    if (e.shiftKey) addMarker(t); else cursor = t;
    afterCursor(); saveSoon();
  });

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    const K = S.keyboard, za = Math.max(1.01, Number(K.zoomAmount) || 2);
    if (keyMatch(e, K.zoomIn)) { zoom(1 / za); e.preventDefault(); return; }
    if (keyMatch(e, K.zoomOut)) { zoom(za); e.preventDefault(); return; }
    if (keyMatch(e, K.zoomFit)) { fit(); e.preventDefault(); return; }
    if (keyMatch(e, K.zoomStart)) { const sp = view.end - view.start; setView(meta.startTime, meta.startTime + sp); e.preventDefault(); return; }
    if (keyMatch(e, K.zoomEnd)) { const sp = view.end - view.start; setView(meta.endTime - sp * 0.95, meta.endTime + sp * 0.05); e.preventDefault(); return; }
    if (keyMatch(e, K.reload)) { vscode.postMessage({ type: 'reload' }); e.preventDefault(); return; }
    if (keyMatch(e, K.addSignal)) { $('sidebar').classList.remove('hidden'); $('filter').focus(); $('filter').select(); resize(); e.preventDefault(); return; }
    switch (e.key) {
      case 'ArrowRight': nextEdge(1); break;
      case 'ArrowLeft': nextEdge(-1); break;
      case 'ArrowUp': selectRow(sel - 1); break;
      case 'ArrowDown': selectRow(sel + 1); break;
      case '+': zoom(0.5); break;
      case '_': zoom(2); break;
      case 'c': case 'C': if (cursor != null) center(cursor); break;
      case 'm': case 'M': if (cursor != null) { addMarker(cursor); } break;
      case 'n': case 'N': gotoMarker(e.shiftKey ? -1 : 1); break;
      case 'F3': stepSearch(e.shiftKey ? -1 : 1); break;
      case 'Delete': case 'Backspace': removeRow(sel); break;
      case 'Escape': hideMenu(); break;
      default: return;
    }
    e.preventDefault();
  });

  /* ---------------------------------------------------------------- toolbar */
  $('bZoomIn').onclick = () => zoom(0.5);
  $('bZoomOut').onclick = () => zoom(2);
  $('bFit').onclick = fit;
  $('bZoomCur').onclick = () => { if (cursor != null) center(cursor); };
  $('bPrev').onclick = () => nextEdge(-1);
  $('bNext').onclick = () => nextEdge(1);
  $('bReload').onclick = () => vscode.postMessage({ type: 'reload' });
  $('bClear').onclick = () => { rows = []; sel = -1; renderRows(); buildTreeMarks(); updateFsmPane(); save(); };
  $('bSidebar').onclick = () => { $('sidebar').classList.toggle('hidden'); $('bSidebar').classList.toggle('on', !$('sidebar').classList.contains('hidden')); resize(); save(); };
  $('bFsm').onclick = () => toggleFsm();

  function toggleFsm(force) {
    const p = $('fsmPane');
    const show = force != null ? force : p.classList.contains('hidden');
    p.classList.toggle('hidden', !show);
    $('bFsm').classList.toggle('on', show);
    resize(); updateFsmPane(); save();
  }

  /* ---------------------------------------------------------------- FSM pane */
  function fsmRows() { return rows.filter(r => r.fsm && fsmByKey.has(r.fsm)); }
  function updateFsmSelect() {
    const list = fsmRows();
    const s = $('fsmSel');
    if (!list.some(r => r.path === fsmRowPath)) fsmRowPath = list.length ? list[0].path : null;
    s.innerHTML = list.map(r => `<option value="${esc(r.path)}"${r.path === fsmRowPath ? ' selected' : ''}>${esc(r.path)}</option>`).join('') || '<option>(no FSM signal)</option>';
  }
  $('fsmSel').onchange = e => { fsmRowPath = e.target.value; updateFsmPane(); save(); };
  $('fsmFit').onclick = () => fsmApi && fsmApi.fit();
  $('fsmSvg').onclick = () => { const r = currentFsmRow(); if (fsmApi && r) vscode.postMessage({ type: 'exportSvg', svg: fsmApi.svgString(), name: 'fsm_' + fsmOf(r).name }); };
  $('fsmSrc').onclick = () => { const r = currentFsmRow(); if (r) { const f = fsmOf(r); vscode.postMessage({ type: 'openSource', file: f.file, line: f.line }); } };

  function currentFsmRow() { return rows.find(r => r.path === fsmRowPath && r.fsm && fsmByKey.has(r.fsm)); }

  function coverage(row, f) {
    const key = row.id + '|' + f.key;
    if (covCache.has(key)) return covCache.get(key);
    const d = cache[row.id];
    if (!d) return null;
    const visited = new Map(), taken = new Map(), unknown = new Map();
    let prev = null;
    for (let k = 0; k < d.t.length; k++) {
      const raw = d.v[k];
      if (isXZ(raw)) { prev = null; continue; }
      const name = f.byValue.get(parseInt(raw, 2));
      if (!name) { if (!unknown.has(raw)) unknown.set(raw, d.t[k]); prev = null; continue; }
      if (!visited.has(name)) visited.set(name, d.t[k]);
      if (prev && prev !== name) { const tk = prev + '->' + name; if (!taken.has(tk)) taken.set(tk, d.t[k]); }
      prev = name;
    }
    const defined = new Set(f.transitions.filter(t => t.from !== t.to).map(t => t.from + '->' + t.to));
    const illegal = [...taken.keys()].filter(k => !defined.has(k)).map(k => { const [from, to] = k.split('->'); return { from, to, t: taken.get(k) }; });
    const res = { visited, taken, defined, illegal, unknown };
    covCache.set(key, res);
    return res;
  }

  function stateAtCursor(row, f) {
    const d = cache[row.id];
    if (!d || cursor == null) return null;
    const k = idxAt(d, cursor);
    if (k < 0 || isXZ(d.v[k])) return null;
    return f.byValue.get(parseInt(d.v[k], 2)) || null;
  }

  function updateFsmCursor() {
    const r = currentFsmRow();
    if (!r || !fsmApi || $('fsmPane').classList.contains('hidden')) return;
    const f = fsmOf(r);
    const s = stateAtCursor(r, f);
    fsmApi.update({ highlight: s });
    $('fsmInfo').innerHTML = `State at cursor: <b>${esc(s || '—')}</b> &nbsp;·&nbsp; ${f.states.length} states, reset ${esc(f.reset)}`;
  }

  function chip(label, cls, t) {
    return `<span class="chip${t != null ? ' click' : ''} ${cls || ''}"${t != null ? ` data-t="${t}"` : ''} title="${t != null ? 'first at ' + fmtTime(t) + ' — click to jump' : ''}">${esc(label)}</span>`;
  }

  function updateFsmPane() {
    updateFsmSelect();
    if ($('fsmPane').classList.contains('hidden')) return;
    const r = currentFsmRow();
    const svg = $('fsmSvgEl');
    if (!r) {
      fsmApi = null; fsmApiKey = null; svg.innerHTML = '';
      $('fsmInfo').innerHTML = fsms.length
        ? `Add a state register (e.g. <b>${esc(fsms[0].stateVars[0] || 'state')}</b>) to the waveform. Signals whose names match an FSM in your RTL are decoded automatically; or right-click a signal → <i>Decode as FSM state</i>.`
        : 'No FSMs found in the workspace RTL. Open the folder containing your Verilog/SystemVerilog sources so 10xEngineers EDA can extract state machines.';
      $('fsmCov').innerHTML = '';
      return;
    }
    const f = fsmOf(r);
    const cov = coverage(r, f);
    const key = r.path + '|' + f.key;
    if (fsmApiKey !== key) {
      fsmApiKey = key;
      fsmApi = FsmRender.render(svg, f, {
        coverage: cov ? { visited: cov.visited, taken: cov.taken, illegal: cov.illegal } : null,
        onNodeClick: name => {
          if (!cov || !cov.visited.has(name)) return;
          const d = cache[r.id];
          const from = cursor == null ? -Infinity : cursor;
          let first = null;
          for (let k = 0; k < d.t.length; k++) {
            if (isXZ(d.v[k])) continue;
            if (f.byValue.get(parseInt(d.v[k], 2)) === name) { if (first == null) first = d.t[k]; if (d.t[k] > from) { first = d.t[k]; break; } }
          }
          if (first != null) { cursor = first; ensureVisible(first); updateValues(); redraw(); updateFsmCursor(); }
        },
        onEdgeClick: t => {
          const d = cache[r.id];
          const from = cursor == null ? -Infinity : cursor;
          let prev = null, hit = null, firstHit = null;
          for (let k = 0; k < d.t.length; k++) {
            const n = isXZ(d.v[k]) ? null : f.byValue.get(parseInt(d.v[k], 2));
            if (prev === t.from && n === t.to) { if (firstHit == null) firstHit = d.t[k]; if (d.t[k] > from) { hit = d.t[k]; break; } }
            prev = n;
          }
          hit = hit != null ? hit : firstHit;
          if (hit != null) { cursor = hit; ensureVisible(hit); updateValues(); redraw(); updateFsmCursor(); }
          else vscode.postMessage({ type: 'openSource', file: f.file, line: t.line });
        }
      });
    } else if (cov) {
      fsmApi.update({ coverage: { visited: cov.visited, taken: cov.taken, illegal: cov.illegal } });
    }
    updateFsmCursor();

    if (!cov) { $('fsmCov').innerHTML = '<div class="empty">loading…</div>'; return; }
    const nS = f.states.length, vS = f.states.filter(s => cov.visited.has(s.name)).length;
    const nT = cov.defined.size, vT = [...cov.defined].filter(k => cov.taken.has(k)).length;
    const pct = (a, b) => b ? Math.round(a * 100 / b) : 100;
    let h = `<h4>FSM coverage (this simulation)</h4>
      <div class="covline"><span>States visited</span><b>${vS}/${nS} · ${pct(vS, nS)}%</b></div><div class="bar"><div style="width:${pct(vS, nS)}%"></div></div>
      <div class="covline"><span>Transitions taken</span><b>${vT}/${nT} · ${pct(vT, nT)}%</b></div><div class="bar"><div style="width:${pct(vT, nT)}%"></div></div>`;
    const unv = f.states.filter(s => !cov.visited.has(s.name));
    if (unv.length) h += `<h4>Never visited</h4>` + unv.map(s => chip(s.name, 'miss')).join('');
    const unT = [...cov.defined].filter(k => !cov.taken.has(k));
    if (unT.length) h += `<h4>Transitions not exercised</h4>` + unT.map(k => chip(k.replace('->', ' → '), 'miss')).join('');
    if (cov.illegal.length) h += `<h4>⚠ Transitions not in RTL</h4>` + cov.illegal.map(x => chip(x.from + ' → ' + x.to, 'bad', x.t)).join('');
    if (cov.unknown.size) h += `<h4>⚠ Illegal encodings seen</h4>` + [...cov.unknown].map(([raw, t]) => chip("'b" + raw, 'bad', t)).join('');
    h += `<h4>Visit order (first entry)</h4>` + [...cov.visited].sort((a, b) => a[1] - b[1]).map(([n, t]) => chip(n, '', t)).join('');
    $('fsmCov').innerHTML = h;
  }
  $('fsmCov').addEventListener('click', e => {
    const c = e.target.closest('.chip.click');
    if (!c) return;
    cursor = +c.dataset.t; ensureVisible(cursor); updateValues(); redraw(); updateFsmCursor();
  });

  /* ================================================================ tools panel */
  const TABS = [['markers', 'Markers'], ['tx', 'Transactions'], ['search', 'Search'], ['activity', 'Activity'], ['xtrace', 'X-trace'], ['log', 'Log']];
  $('toolTabs').innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('') + '<span class="grow"></span><button id="tClose" title="Hide tools panel">✕</button>';
  $('toolTabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'tClose') { toggleTools(false); return; }
    showTab(b.dataset.tab);
  });
  function toggleTools(force) {
    const p = $('tools');
    const show = force != null ? force : p.classList.contains('hidden');
    p.classList.toggle('hidden', !show); $('bTools').classList.toggle('on', show);
    resize(); save();
  }
  function showTab(k, noOpen) {
    if (!TABS.some(t => t[0] === k)) k = 'markers';
    activeTab = k;
    if (!noOpen && $('tools').classList.contains('hidden')) toggleTools(true);
    document.querySelectorAll('#toolTabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
    document.querySelectorAll('#toolBody > .tab').forEach(d => d.classList.toggle('hidden', d.id !== 'tab-' + k));
    ({ markers: renderMarkers, tx: renderTx, search: () => {}, activity: renderActivity, xtrace: () => runXtrace(), log: renderLog })[k]();
  }
  $('bTools').onclick = () => toggleTools();
  const jump = t => { cursor = t; ensureVisible(t); afterCursor(); };
  $('toolBody').addEventListener('click', e => {
    const j = e.target.closest('[data-t]');
    if (j && !e.target.closest('button,input,select')) jump(+j.dataset.t);
  });

  /* ---------------- named markers */
  const MARKER_COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fb923c', '#a78bfa', '#facc15', '#2dd4bf', '#f87171'];
  function addMarker(t, name, quiet) {
    if (t == null) return;
    const id = markerSeq++;
    markers.push({ id, name: name || 'M' + id, t, color: MARKER_COLORS[(id - 1) % MARKER_COLORS.length] });
    markers.sort((a, b) => a.t - b.t);
    if (!quiet) { renderMarkers(); updateValues(); redraw(); saveSoon(); toast(`Marker ${name || 'M' + id} at ${fmtTime(t)} — double-click it or use the Markers tab to rename`); }
  }
  function nearestMarker() {
    if (!markers.length) return null;
    if (cursor == null) return markers[0];
    return markers.reduce((b, m) => Math.abs(m.t - cursor) < Math.abs(b.t - cursor) ? m : b);
  }
  function markerNearX(x) {
    const W = wavecol.clientWidth, span = view.end - view.start;
    return markers.find(m => Math.abs((m.t - view.start) * W / span - x) < 5);
  }
  function renameMarker(id) {
    showTab('markers');
    const inp = document.querySelector(`#tab-markers input[data-id="${id}"]`);
    if (inp) { inp.focus(); inp.select(); }
  }
  function gotoMarker(dir) {
    if (!markers.length) return;
    const from = cursor == null ? -Infinity : cursor;
    const m = dir > 0 ? (markers.find(x => x.t > from) || markers[0]) : (markers.filter(x => x.t < from).pop() || markers[markers.length - 1]);
    jump(m.t);
  }
  function renderMarkers() {
    const el = $('tab-markers');
    if (!el || activeTab !== 'markers') return;
    let h = `<div class="tbar"><button id="mkAdd">＋ Marker at cursor (M)</button><button id="mkClear">Clear all</button><span class="hint">Shift+click waves/ruler adds a marker · double-click a marker line to rename · N / Shift+N jumps</span></div>`;
    if (!markers.length) { el.innerHTML = h + '<div class="empty">No markers yet.</div>'; }
    else {
      h += `<table class="tt"><tr><th></th><th>Name</th><th>Time</th><th>Δ cursor</th><th>Δ previous</th><th></th></tr>`;
      markers.forEach((m, k) => {
        h += `<tr data-t="${m.t}"><td><span class="sw" style="background:${esc(m.color)}"></span></td><td><input type="text" data-id="${m.id}" value="${esc(m.name)}"></td><td class="mono">${fmtTime(m.t)}</td><td class="mono">${cursor != null ? (cursor >= m.t ? '+' : '−') + fmtTime(Math.abs(cursor - m.t)) : '-'}</td><td class="mono">${k ? fmtTime(m.t - markers[k - 1].t) : ''}</td><td><button data-mv="${m.id}" title="Move marker to cursor">⇢cur</button><button data-del="${m.id}" title="Delete">✕</button></td></tr>`;
      });
      el.innerHTML = h + '</table>';
    }
    $('mkAdd').onclick = () => addMarker(cursor != null ? cursor : Math.round((view.start + view.end) / 2));
    $('mkClear').onclick = () => { markers = []; renderMarkers(); updateValues(); redraw(); save(); };
    el.querySelectorAll('input[data-id]').forEach(inp => inp.addEventListener('change', () => { const m = markers.find(x => x.id === +inp.dataset.id); if (m) { m.name = inp.value.trim() || m.name; redraw(); updateValues(); save(); } }));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { markers = markers.filter(x => x.id !== +b.dataset.del); renderMarkers(); updateValues(); redraw(); save(); });
    el.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const m = markers.find(x => x.id === +b.dataset.mv); if (m && cursor != null) { m.t = cursor; markers.sort((a, c) => a.t - c.t); renderMarkers(); redraw(); save(); } });
  }

  /* ---------------- protocol decoders + transaction table */
  function sigOf(path) { const v = allVars.get(path); return v ? cache[v.id] : null; }
  function decRow(dc) { return { dec: { id: dc.id, proto: WT.DECODERS[dc.proto].label }, path: 'decoder:' + dc.id, id: 'dec' + dc.id, name: `${WT.DECODERS[dc.proto].label} #${dc.id}`, scope: '', width: 0, type: 'decoder', radix: 'hex' }; }
  function recomputeDecoders() {
    decoders.forEach(dc => {
      const sig = {}; let ok = true;
      for (const [role, p] of Object.entries(dc.map)) { if (!p) continue; const d = sigOf(p); if (!d) { ok = false; break; } sig[role] = d; }
      if (!ok) { dc.tx = []; return; }
      try { dc.tx = WT.DECODERS[dc.proto].decode(sig, dc.params || {}) || []; dc.err = ''; } catch (e) { dc.tx = []; dc.err = String(e.message || e); }
    });
    if (activeTab === 'tx') renderTx();
  }
  function varOptions(selected) {
    const list = rows.filter(r => !r.dec).map(r => r.path);
    const all = [...new Set(list.concat(allVars.size <= 4000 ? [...allVars.keys()] : []))];
    return '<option value="">(none)</option>' + all.map(p => `<option value="${esc(p)}"${p === selected ? ' selected' : ''}>${esc(p)}</option>`).join('');
  }
  let txFilter = '';
  function renderTx() {
    const el = $('tab-tx'); if (!el) return;
    const protoOpts = Object.entries(WT.DECODERS).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join('');
    let h = `<div class="tbar"><select id="decProto">${protoOpts}</select><button id="decAdd">＋ Add decoder (auto-map signals)</button><input id="txFilter" type="text" placeholder="filter transactions (e.g. WRITE, 0x40, error)" value="${esc(txFilter)}"><button id="txCsv">Copy CSV</button></div>`;
    decoders.forEach(dc => {
      const D = WT.DECODERS[dc.proto];
      h += `<details class="dec" open><summary><b>${esc(D.label)} #${dc.id}</b> · ${dc.tx.length} transaction(s)${dc.err ? ` · <span class="bad">${esc(dc.err)}</span>` : ''} <button data-decdel="${dc.id}">Remove</button></summary><div class="roles">`;
      D.roles.forEach(r => { h += `<label>${r}<select data-dec="${dc.id}" data-role="${r}">${varOptions(dc.map[r])}</select></label>`; });
      Object.entries(D.params || {}).forEach(([p, def]) => { h += `<label>${p}<input type="text" data-dec="${dc.id}" data-param="${p}" value="${esc(dc.params && dc.params[p] != null ? dc.params[p] : def)}"></label>`; });
      h += `</div></details>`;
    });
    const all = decoders.flatMap(dc => dc.tx.map(tx => Object.assign({ dec: `${WT.DECODERS[dc.proto].label} #${dc.id}` }, tx))).sort((a, b) => a.t - b.t);
    const q = txFilter.toLowerCase();
    const shown = q ? all.filter(tx => JSON.stringify(tx).toLowerCase().includes(q)) : all;
    if (decoders.length) {
      h += `<table class="tt"><tr><th>Start</th><th>End</th><th>Decoder</th><th>Kind</th><th>Addr</th><th>Data</th><th>Info</th></tr>`;
      shown.slice(0, 2000).forEach(tx => { h += `<tr data-t="${tx.t}" class="${tx.error ? 'err' : ''}"><td class="mono">${fmtTime(tx.t)}</td><td class="mono">${fmtTime(tx.t1)}</td><td>${esc(tx.dec)}</td><td>${esc(tx.kind)}</td><td class="mono">${esc(tx.addr || '')}</td><td class="mono">${esc(tx.data || '')}</td><td>${esc(tx.error || tx.info || '')}</td></tr>`; });
      h += '</table>' + (shown.length > 2000 ? `<div class="hint">showing 2000 of ${shown.length}</div>` : '');
    } else h += `<div class="empty">Pick a protocol and press <b>Add decoder</b>. Signals are mapped automatically from their names (e.g. psel/penable/paddr, tvalid/tready, scl/sda); adjust any role with the drop-downs. A decoded row is added to the waveform and every transaction is listed here — click a row to jump.</div>`;
    el.innerHTML = h;
    $('decAdd').onclick = () => {
      const proto = $('decProto').value;
      const D = WT.DECODERS[proto];
      const map = WT.guessRoles(proto, [...new Set(rows.filter(r => !r.dec).map(r => r.path).concat([...allVars.keys()]))]);
      const dc = { id: decSeq++, proto, map, params: Object.assign({}, D.params), tx: [] };
      decoders.push(dc);
      rows.push(decRow(dc));
      requestMissing(); recomputeDecoders(); renderRows(); renderTx(); save();
      const missing = D.roles.filter(r => !map[r]);
      toast(missing.length ? `Mapped ${D.roles.length - missing.length}/${D.roles.length} roles — set: ${missing.join(', ')}` : 'All roles mapped');
    };
    $('txFilter').oninput = e => { txFilter = e.target.value; clearTimeout(renderTx.t); renderTx.t = setTimeout(() => { renderTx(); const f = $('txFilter'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 250); };
    $('txCsv').onclick = () => {
      const csv = ['start,end,decoder,kind,addr,data,info'].concat(shown.map(tx => [tx.t, tx.t1, tx.dec, tx.kind, tx.addr || '', tx.data || '', (tx.error || tx.info || '').replace(/,/g, ';')].join(','))).join('\n');
      navigator.clipboard.writeText(csv).then(() => toast('Transaction table copied as CSV'), () => vscode.postMessage({ type: 'info', text: 'Clipboard not available' }));
    };
    el.querySelectorAll('select[data-role]').forEach(s => s.onchange = () => { const dc = decoders.find(x => x.id === +s.dataset.dec); dc.map[s.dataset.role] = s.value || undefined; requestMissing(); recomputeDecoders(); redraw(); save(); });
    el.querySelectorAll('input[data-param]').forEach(s => s.onchange = () => { const dc = decoders.find(x => x.id === +s.dataset.dec); dc.params[s.dataset.param] = s.value; recomputeDecoders(); redraw(); save(); });
    el.querySelectorAll('[data-decdel]').forEach(b => b.onclick = ev => { ev.preventDefault(); const id = +b.dataset.decdel; decoders = decoders.filter(x => x.id !== id); rows = rows.filter(r => !(r.dec && r.dec.id === id)); renderRows(); renderTx(); redraw(); save(); });
  }

  /* ---------------- multi-signal pattern search */
  function resolveName(name) {
    const base = name.replace(/\[.*$/, '');
    const cands = rows.filter(r => !r.dec);
    const noW = p => p.replace(/\s*\[[^\]]*\]$/, '');   // "tb.dut.state[2:0]" -> "tb.dut.state"
    const hit = cands.find(r => r.path === name || noW(r.path) === base) || cands.find(r => r.name.replace(/\s*\[.*$/, '') === base) || cands.find(r => noW(r.path).endsWith('.' + base));
    if (hit) return hit.id;
    for (const v of allVars.values()) if (v.path === name || noW(v.path) === base || noW(v.path).endsWith('.' + base) || v.name.replace(/\s*\[.*$/, '') === base) return v.id;
    return null;
  }
  function runSearch() {
    const expr = $('srchExpr').value.trim();
    const out = $('srchOut');
    if (!expr) return;
    try {
      const c = WT.compileExpr(expr, resolveName);
      const missing = c.keys.filter(k => !cache[k]);
      if (missing.length) { missing.forEach(id => pending.add(id)); vscode.postMessage({ type: 'request', ids: missing }); out.innerHTML = 'loading signals… press Find again'; return; }
      searchHits = WT.search(expr, cache, resolveName, 5000);
      searchIdx = -1;
      out.innerHTML = `<b>${searchHits.length}</b> match(es) — the expression becomes true at:` + `<div class="chips">${searchHits.slice(0, 300).map(t => `<span class="chip click" data-t="${t}">${fmtTime(t)}</span>`).join('')}</div>`;
      redraw();
      if (searchHits.length) stepSearch(1);
    } catch (e) { out.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
  }
  function stepSearch(dir) {
    if (!searchHits.length) return;
    const from = cursor == null ? -Infinity : cursor;
    let k = dir > 0 ? searchHits.findIndex(t => t > from) : (() => { let j = -1; searchHits.forEach((t, i) => { if (t < from) j = i; }); return j; })();
    if (k < 0) k = dir > 0 ? 0 : searchHits.length - 1;
    searchIdx = k; jump(searchHits[k]);
  }
  $('tab-search').innerHTML = `<div class="tbar"><input id="srchExpr" type="text" placeholder="valid && ready && data == 8'hFF    ·    state != 0 && err    ·    addr >= 0x40" style="flex:1"><button id="srchGo">Find</button><button id="srchPrev">◀</button><button id="srchNext">▶ (F3)</button></div><div class="hint">Operators: == != &lt; &gt; &lt;= &gt;= &amp;&amp; || ! &amp; | ^ ~ + - · literals 8'hFF, 'b101, 0x1F, 42 · names match signals in the view (or any signal by full path). X/Z never match.</div><div id="srchOut"></div>`;
  $('srchGo').onclick = runSearch;
  $('srchExpr').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  $('srchPrev').onclick = () => stepSearch(-1);
  $('srchNext').onclick = () => stepSearch(1);

  /* ---------------- switching activity */
  function renderActivity() {
    const el = $('tab-activity'); if (!el) return;
    const mks = markers.length >= 2 ? [markers[0].t, markers[markers.length - 1].t] : null;
    const range = $('actRange') ? $('actRange').value : 'view';
    const [t0, t1] = range === 'all' ? [meta.startTime, meta.endTime] : range === 'markers' && mks ? mks : [view.start, view.end];
    const dur = Math.max(1, t1 - t0);
    const list = rows.filter(r => !r.dec && cache[r.id]).map(r => { const a = WT.activity(cache[r.id], t0, t1); return { r, ...a, rate: a.toggles / dur, per: a.toggles / Math.max(1, r.width) }; }).sort((a, b) => b.toggles - a.toggles);
    const max = Math.max(1, ...list.map(x => x.toggles));
    let h = `<div class="tbar"><label>Window <select id="actRange"><option value="view"${range === 'view' ? ' selected' : ''}>visible range</option><option value="all"${range === 'all' ? ' selected' : ''}>whole simulation</option><option value="markers"${range === 'markers' ? ' selected' : ''}${mks ? '' : ' disabled'}>first → last marker</option></select></label><span class="hint">${fmtTime(t0)} – ${fmtTime(t1)} · toggles = bit flips (Hamming distance of each change) · signals in the view only</span></div>`;
    h += `<table class="tt"><tr><th>Signal</th><th>Width</th><th>Value changes</th><th>Bit toggles</th><th>Toggles / bit</th><th>Activity</th></tr>`;
    list.forEach(x => { h += `<tr><td>${esc(x.r.path)}</td><td>${x.r.width}</td><td class="mono">${x.changes}</td><td class="mono">${x.toggles}</td><td class="mono">${x.per.toFixed(1)}</td><td><div class="bar"><div style="width:${(x.toggles * 100 / max).toFixed(1)}%"></div></div></td></tr>`; });
    h += '</table>';
    const quiet = list.filter(x => x.changes === 0);
    if (quiet.length) h += `<div class="hint">${quiet.length} signal(s) never change in this window: ${quiet.slice(0, 20).map(x => esc(x.r.name)).join(', ')}${quiet.length > 20 ? '…' : ''}</div>`;
    el.innerHTML = h;
    $('actRange').onchange = renderActivity;
  }

  /* ---------------- X-trace */
  function runXtrace(i) {
    const el = $('tab-xtrace');
    const r = rows[i != null ? i : sel];
    if (!r || r.dec) { el.innerHTML = '<div class="empty">Select a signal row and place the cursor where it is X, then right-click → <b>X-trace this signal at cursor</b>.</div>'; return; }
    if (cursor == null) { el.innerHTML = '<div class="empty">Place the cursor first.</div>'; return; }
    const d = cache[r.id];
    if (!d) { el.innerHTML = '<div class="empty">Loading signal data… open the tab again in a moment.</div>'; return; }
    const others = [...allVars.values()].filter(v => v.path !== r.path && cache[v.id]).map(v => ({ name: v.path, sig: cache[v.id] }));
    const notLoaded = [...allVars.values()].filter(v => !cache[v.id] && v.width < 4096).map(v => v.id);
    const res = WT.xtrace({ name: r.path, sig: d }, others, cursor);
    let h = `<div class="tbar"><b>${esc(r.path)}</b> @ ${fmtTime(cursor)}<button id="xtLoad"${notLoaded.length ? '' : ' disabled'}>Load all ${notLoaded.length} other signals and retrace</button><button id="xtRtlGo" title="Walk the X back through assign / always / port connections in your RTL to the signal where it starts">Trace through RTL drivers</button></div>`;
    if (!res.isX) h += `<div class="empty">The value is known (no X/Z) at the cursor.</div>`;
    else {
      h += `<div>Value <b class="mono">${esc(res.value)}</b> has been unknown since <span class="chip click" data-t="${res.since}">${fmtTime(res.since)}</span>.</div>`;
      h += `<div class="hint">Likely sources: signals already X/Z at that moment, earliest first (from ${others.length} loaded signals). Open the RTL drivers with <b>Show drivers</b> in the editor to confirm.</div>`;
      h += `<table class="tt"><tr><th>Signal</th><th>Unknown since</th><th>Value</th></tr>` + res.candidates.slice(0, 200).map(c => `<tr data-t="${c.since}"><td>${esc(c.name)}</td><td class="mono">${fmtTime(c.since)}</td><td class="mono">${esc(c.value)}</td></tr>`).join('') + '</table>';
      if (!res.candidates.length) h += `<div class="hint">No other loaded signal is X at that time — the X probably comes from an uninitialised register or an undriven input (press Load all to check every signal).</div>`;
    }
    el.innerHTML = h;
    $('xtRtlGo').onclick = () => rtlTrace(i);
    $('xtLoad').onclick = () => { xtrace.wait = i != null ? i : sel; notLoaded.forEach(id => pending.add(id)); vscode.postMessage({ type: 'request', ids: notLoaded }); el.insertAdjacentHTML('beforeend', '<div class="hint">loading…</div>'); setTimeout(() => runXtrace(xtrace.wait), 900); };
  }
  const xtrace = {};

  /* X-trace through the RTL: the host walks drivers (assign / always / port connections) back to where the X starts */
  function rtlTrace(i) {
    const r = rows[i != null ? i : sel];
    if (!r || r.dec || cursor == null) return;
    const el = $('tab-xtrace');
    let box = $('xtRtl');
    if (!box) { el.insertAdjacentHTML('beforeend', '<div id="xtRtl"></div>'); box = $('xtRtl'); }
    box.innerHTML = '<div class="hint">tracing through the RTL drivers…</div>';
    vscode.postMessage({ type: 'xtraceRtl', path: r.path, t: cursor });
  }
  function renderRtlTrace(m) {
    let box = $('xtRtl');
    if (!box) { $('tab-xtrace').insertAdjacentHTML('beforeend', '<div id="xtRtl"></div>'); box = $('xtRtl'); }
    if (m.error) { box.innerHTML = `<div class="bad">${esc(m.error)}</div>`; return; }
    if (m.known) { box.innerHTML = `<div class="empty">The value is known at the cursor (${esc(m.value || '')}).</div>`; return; }
    const link = (f, l, txt) => f != null && l != null ? `<a href="#" class="src" data-f="${esc(f)}" data-l="${l}">${esc(txt)}</a>` : esc(txt || '');
    let h = `<h4 style="margin:10px 0 4px">Through the RTL drivers <span class="hint">(${m.modules} module(s) indexed · structural, no elaboration)</span></h4>`;
    h += '<table class="tt"><tr><th>#</th><th>Signal</th><th>Unknown since</th><th>Value</th><th>Driver</th><th>Why the trace moved on</th></tr>';
    (m.steps || []).forEach((s, k) => {
      h += `<tr data-t="${s.since}"><td>${k + 1}</td><td>${link(s.file, s.line, s.path)}${s.module ? ` <span class="hint">(${esc(s.module)})</span>` : ''}</td><td class="mono"><span class="chip click" data-t="${s.since}">${fmtTime(s.since)}</span></td><td class="mono">${esc(s.value || '')}</td><td class="mono">${link(s.driverFile, s.driverLine, s.driverText ? `${s.driverLine + 1}: ${s.driverText}` : '')}</td><td>${esc(s.why || '')}${s.whyT != null ? ' ' + fmtTime(s.whyT) : ''}</td></tr>`;
    });
    h += '</table>';
    if (m.root) h += `<div class="xroot"><b>Origin:</b> ${link(m.root.file, m.root.line, m.root.path)} @ <span class="chip click" data-t="${m.root.since}">${fmtTime(m.root.since)}</span> — ${esc(m.root.reason || '')}${m.root.driverText ? `<br><span class="hint">driver: </span>${link(m.root.driverFile, m.root.driverLine, (m.root.driverLine + 1) + ': ' + m.root.driverText)}` : ''}</div>`;
    (m.notes || []).forEach(n => { h += `<div class="hint">${esc(n)}</div>`; });
    h += '<div class="tbar"><button id="xtAdd">Add the chain to the waveform</button></div>';
    box.innerHTML = h;
    box.querySelectorAll('a.src').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); vscode.postMessage({ type: 'openFileLine', file: a.dataset.f, line: +a.dataset.l }); });
    $('xtAdd').onclick = () => {
      const bare = p => p.replace(/\s*\[[^\]]*\]$/, '');
      (m.steps || []).forEach(s => { const v = [...allVars.values()].find(x => bare(x.path) === s.path); if (v && !rows.some(r => r.path === v.path)) addSignal(v, false); });
      afterAdd();
    };
  }

  /* ---------------- log correlation (cocotb / $display / UVM) */
  function renderLog() {
    const el = $('tab-log'); if (!el) return;
    let h = `<div class="tbar"><button id="logLoad">Open log…</button><input id="logFilter" type="text" placeholder="filter (ERROR, scoreboard, …)" value="${esc(renderLog.q || '')}"><span class="hint">cocotb (“1234.00ns INFO …”), UVM (“@ 120: …”) and Questa/Icarus “# … at time” lines are matched to waveform time · click a line to jump</span></div>`;
    const q = (renderLog.q || '').toLowerCase();
    const list = q ? logEntries.filter(x => x.text.toLowerCase().includes(q)) : logEntries;
    if (!logEntries.length) h += '<div class="empty">No log loaded. Press <b>Open log…</b> and pick a cocotb/simulator log (results.xml is not needed).</div>';
    else h += `<table class="tt">` + list.slice(0, 3000).map(x => `<tr data-t="${x.t}" class="${/ERROR|FATAL|CRITICAL/.test(x.level) ? 'err' : x.level === 'WARNING' ? 'warn' : ''}"><td class="mono">${fmtTime(x.t)}</td><td>${esc(x.level)}</td><td class="mono">${esc(x.text)}</td><td><button data-line="${x.line}" title="Open in log file">↗</button></td></tr>`).join('') + '</table>';
    el.innerHTML = h;
    $('logLoad').onclick = () => vscode.postMessage({ type: 'loadLog' });
    $('logFilter').oninput = e => { renderLog.q = e.target.value; clearTimeout(renderLog.t); renderLog.t = setTimeout(() => { renderLog(); const f = $('logFilter'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 250); };
    el.querySelectorAll('[data-line]').forEach(b => b.onclick = () => vscode.postMessage({ type: 'openLogLine', line: +b.dataset.line }));
  }

  $('bGtkw').onclick = () => vscode.postMessage({ type: 'importGtkw' });
  $('bMarker').onclick = () => addMarker(cursor != null ? cursor : Math.round((view.start + view.end) / 2));

  /* ---------------------------------------------------------------- persistence */
  function layout() {
    return {
      rows: rows.map(r => r.dec ? { dec: r.dec.id } : ({ path: r.path, radix: r.radix, fsm: r.fsm, color: r.color || undefined, renderer: r.renderer || undefined, strokeWidth: r.strokeWidth || undefined, fillA: r.fillA })),
      decoders: decoders.map(dc => ({ id: dc.id, proto: dc.proto, map: dc.map, params: dc.params })),
      markers, view, cursor, sel,
      tools: !$('tools').classList.contains('hidden'), tab: activeTab,
      sidebar: !$('sidebar').classList.contains('hidden'),
      fsmPane: !$('fsmPane').classList.contains('hidden'),
      fsmRow: fsmRowPath
    };
  }
  function save() { vscode.postMessage({ type: 'saveLayout', layout: layout() }); }
  let saveT;
  function saveSoon() { clearTimeout(saveT); saveT = setTimeout(save, 600); }

  function applyLayout(l) {
    rows = [];
    decoders = (l && l.decoders || []).map(dc => Object.assign({ tx: [] }, dc));
    decSeq = decoders.reduce((a, dc) => Math.max(a, dc.id + 1), 1);
    if (l && l.rows) {
      l.rows.forEach(lr => {
        if (lr.dec != null) { const dc = decoders.find(x => x.id === lr.dec); if (dc) rows.push(decRow(dc)); return; }
        const v = allVars.get(lr.path);
        if (!v) return;
        const fsm = lr.fsm && fsmByKey.has(lr.fsm) ? lr.fsm : (lr.fsm === null ? null : autoFsm(v));
        rows.push({ path: v.path, id: v.id, name: v.name, scope: v.scope, width: v.width, type: v.type, radix: lr.radix || (v.width > 1 ? S.display.defaultTraceStyle.radix : 'bin'), fsm, color: lr.color, renderer: lr.renderer, strokeWidth: lr.strokeWidth, fillA: lr.fillA });
      });
    }
    markers = l && Array.isArray(l.markers) ? l.markers : (l && l.marker != null ? [{ id: 1, name: 'M1', t: l.marker }] : []);
    markerSeq = markers.reduce((a, mk) => Math.max(a, (mk.id || 0) + 1), 1);
    if (l && l.tools) { $('tools').classList.remove('hidden'); $('bTools').classList.add('on'); }
    if (l && l.tab) activeTab = l.tab;
    if (!rows.length && !(l && l.rows)) {
      // first open: show top-level-ish signals automatically (up to 24) incl. any FSM state vars
      const vs = [...allVars.values()];
      const fsmVars = vs.filter(v => autoFsm(v));
      const pick = [...new Set([...vs.slice(0, 24 - Math.min(fsmVars.length, 8)), ...fsmVars.slice(0, 8)])];
      pick.forEach(v => rows.push({ path: v.path, id: v.id, name: v.name, scope: v.scope, width: v.width, type: v.type, radix: v.width > 1 ? S.display.defaultTraceStyle.radix : 'bin', fsm: autoFsm(v) }));
    }
    sel = l && l.sel != null && l.sel < rows.length ? l.sel : -1;
    cursor = l ? l.cursor : null;
    fsmRowPath = l && l.fsmRow ? l.fsmRow : (rows.find(r => r.fsm) || {}).path || null;
    if (l && l.sidebar === false) $('sidebar').classList.add('hidden');
    $('bSidebar').classList.toggle('on', !$('sidebar').classList.contains('hidden'));
    const showFsm = l ? !!l.fsmPane : rows.some(r => r.fsm);
    $('fsmPane').classList.toggle('hidden', !showFsm);
    $('bFsm').classList.toggle('on', showFsm);
    renderRows();
    buildTreeMarks();
    requestMissing();
    if (l && l.view && l.view.end > l.view.start) setView(l.view.start, l.view.end); else fit();
    updateFsmPane();
    showTab(activeTab, true);
  }

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.add('hidden'), 1800);
  }

  new ResizeObserver(resize).observe(scroller);
  vscode.postMessage({ type: 'ready' });
})();

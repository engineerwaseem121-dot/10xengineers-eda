'use strict';
/* 10xEngineers EDA — WaveDrom timing diagrams: own renderer (SVG) + SystemVerilog assertion generation from node/edge
 * annotations. Supports the WaveJSON subset used for protocol timing: signal lanes (wave, data, node, period, phase),
 * groups, spacers, edges "a~>c", "a->c", "a-|>c", "a|->c", "a-~>c", "a<->c", "a~c" (undirected) with optional labels.
 *
 * SVA rules
 *  - Each node is an event on its lane at its slot:  0→1 = $rose(s), 1→0 = $fell(s), x→data = !$isunknown(s),
 *    data→data = $changed(s), →x = $isunknown(s), held level = s / !s / (s == value).
 *  - Edge delay = (slot(target) − slot(source)) clock cycles, computed from node positions (period/phase aware).
 *  - Directed edge  a→c : assert property (@(clk) disable iff (rst) EV(a) |-> ##d EV(c))
 *    Bidirectional a↔c : the forward assertion plus EV(c) |-> $past(EV(a), d)
 *    Undirected  a~c   : cover property (EV(a) ##d EV(c))
 *  - Edge label may override timing: "[1:3]", "1..3", "##2", "<=4" (→ ##[1:4]), "$" (→ ##[1:$]); other text becomes the property name/comment.
 */

/* ------------------------------------------------------------------ relaxed JSON (WaveJSON is usually JSON5) */
function parseWaveJson(text) {
  let s = String(text).replace(/^﻿/, '').trim();
  // allow a fenced ```wavedrom block or an assignment
  const fence = /```\s*wavedrom\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch (e) { /* relaxed below */ }
  let out = '', i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1, str = '';
      while (j < n && s[j] !== q) { if (s[j] === '\\' && j + 1 < n) { str += s[j] + s[j + 1]; j += 2; continue; } str += s[j++]; }
      out += JSON.stringify(q === "'" ? str.replace(/\\'/g, "'").replace(/\\"/g, '"') : JSON.parse('"' + str + '"'));
      i = j + 1; continue;
    }
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(s[j])) j++;
      const word = s.slice(i, j);
      let k = j; while (k < n && /\s/.test(s[k])) k++;
      if (s[k] === ':' && !/^(true|false|null)$/.test(word)) out += JSON.stringify(word); else out += word;
      i = j; continue;
    }
    out += c; i++;
  }
  out = out.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(out);
}

/* ------------------------------------------------------------------ lanes */
function flattenLanes(signal, prefix, out) {
  out = out || [];
  for (const it of signal || []) {
    if (Array.isArray(it)) { const name = typeof it[0] === 'string' ? it[0] : ''; flattenLanes(it.slice(typeof it[0] === 'string' ? 1 : 0), name ? (prefix ? prefix + '.' : '') + name : prefix, out); }
    else if (it && typeof it === 'object') out.push(Object.assign({ group: prefix || '' }, it));
  }
  return out;
}
const isClockChar = c => /[pPnNlLhH]/.test(c) && false;
/** expand a lane's wave string to one state per slot; '.' / '|' continue the previous state */
function expandLane(lane) {
  const wave = String(lane.wave || '');
  const period = Math.max(1, Number(lane.period) || 1);
  const data = Array.isArray(lane.data) ? lane.data.slice() : typeof lane.data === 'string' ? lane.data.trim().split(/\s+/) : [];
  const slots = [];
  let prev = null, di = 0;
  for (let i = 0; i < wave.length; i++) {
    let c = wave[i];
    let st;
    if (c === '.' || c === '|') { st = prev ? Object.assign({}, prev, { start: false, gap: c === '|' }) : { k: 'x', start: false }; }
    else if (c === '=' || /[2-9]/.test(c)) st = { k: 'd', label: data[di++] != null ? String(data[di - 1]) : '', color: c, start: true };
    else if (/[01lhLH]/.test(c)) st = { k: /[1hH]/.test(c) ? '1' : '0', start: true, raw: c };
    else if (/[pPnN]/.test(c)) st = { k: 'clk', pos: /[pP]/.test(c), start: true, raw: c };
    else if (c === 'x') st = { k: 'x', start: true };
    else if (c === 'z') st = { k: 'z', start: true };
    else if (c === 'u') st = { k: '1', start: true, raw: 'u' };
    else if (c === 'd') st = { k: '0', start: true, raw: 'd' };
    else st = prev ? Object.assign({}, prev, { start: false }) : { k: 'x', start: false };
    for (let p = 0; p < period; p++) slots.push(p === 0 ? st : Object.assign({}, st, { start: false }));
    prev = st;
  }
  const phase = Number(lane.phase) || 0;
  return { slots, period, phase };
}

/* ------------------------------------------------------------------ nodes, events, edges */
function collectNodes(lanes) {
  const nodes = {};
  lanes.forEach((ln, li) => {
    if (!ln.node) return;
    const ex = expandLane(ln);
    const period = ex.period;
    String(ln.node).split('').forEach((ch, i) => {
      if (ch === '.' || ch === ' ') return;
      nodes[ch] = { id: ch, lane: li, slot: i * period - (Number(ln.phase) || 0), wi: i };
    });
  });
  return nodes;
}
function sigName(lane) { return String(lane.name || 'sig').replace(/[^\w]/g, '_').replace(/^(\d)/, '_$1') || 'sig'; }
/** SystemVerilog expression for the event at a node */
function eventExpr(lane, wi) {
  const s = sigName(lane);
  const ex = expandLane(lane);
  const slots = ex.slots;
  const at = slots[wi * ex.period] || slots[slots.length - 1];
  const before = wi > 0 ? slots[wi * ex.period - 1] : null;
  if (!at) return s;
  if (at.k === 'clk') return s;
  if (at.start) {
    if (at.k === '1') return before && before.k === '1' ? s : `$rose(${s})`;
    if (at.k === '0') return before && before.k === '0' ? `!${s}` : `$fell(${s})`;
    if (at.k === 'x') return `$isunknown(${s})`;
    if (at.k === 'z') return `(${s} === 'z)`;
    if (at.k === 'd') {
      const val = /^(0x[0-9a-f]+|\d+|'[bhd][0-9a-fA-F_]+|\d+'[bhd][0-9a-fA-F_]+)$/i.test(at.label) ? at.label.replace(/^0x/i, "'h") : null;
      if (val) return `(${s} == ${val})`;
      return before && before.k === 'd' ? `$changed(${s})` : `!$isunknown(${s})`;
    }
  }
  if (at.k === '1') return s;
  if (at.k === '0') return `!${s}`;
  if (at.k === 'x') return `$isunknown(${s})`;
  if (at.k === 'd') return `$stable(${s})`;
  return s;
}
function parseEdge(e) {
  const m = /^\s*([^\s~\-|<>])\s*([<]?[-~|]+[>]?)\s*([^\s~\-|<>])\s*(.*)$/.exec(e);
  if (!m) return null;
  const shape = m[2];
  return { from: m[1], to: m[3], shape, label: m[4].trim(), directed: shape.endsWith('>'), both: shape.startsWith('<') && shape.endsWith('>') };
}
function timing(label, d) {
  let m;
  if ((m = /\[\s*(\d+)\s*:\s*(\d+|\$)\s*\]/.exec(label))) return { range: `##[${m[1]}:${m[2]}]`, text: label.replace(m[0], '').trim() };
  if ((m = /(\d+)\s*\.\.\s*(\d+|\$)/.exec(label))) return { range: `##[${m[1]}:${m[2]}]`, text: label.replace(m[0], '').trim() };
  if ((m = /##\s*(\d+)/.exec(label))) return { range: `##${m[1]}`, n: +m[1], text: label.replace(m[0], '').trim() };
  if ((m = /<=\s*(\d+)/.exec(label))) return { range: `##[1:${m[1]}]`, text: label.replace(m[0], '').trim() };
  if (/^\s*\$\s*$/.test(label)) return { range: '##[1:$]', text: '' };
  return { range: d > 0 ? `##${d}` : '', n: d, text: label };
}
function generateSva(wj, opts) {
  opts = Object.assign({ module: 'timing_sva', clock: null, reset: null, resetActiveLow: true }, (wj.config && wj.config.sva) || {}, opts || {});
  const lanes = flattenLanes(wj.signal);
  const real = lanes.filter(l => l.wave != null || l.name);
  const nodes = collectNodes(real);
  const clkLane = real.find(l => /[pPnN]/.test(String(l.wave || '')));
  const clock = opts.clock || (clkLane ? sigName(clkLane) : 'clk');
  const edgeKw = clkLane && /^[nN]/.test(String(clkLane.wave).replace(/[.|]/g, '')) ? 'negedge' : 'posedge';
  const rstLane = real.find(l => /^([pha]?(rst|reset)_?n?|arst_?n?|areset_?n?)$/i.test(sigName(l)));
  const reset = opts.reset || (rstLane ? sigName(rstLane) : null);
  const rstLow = reset ? /_?n$/i.test(reset) : opts.resetActiveLow;
  const dis = reset ? ` disable iff (${rstLow ? '!' : ''}${reset})` : '';
  const ports = real.filter(l => l.wave != null && l !== clkLane).map(l => {
    const isData = /[=2-9]/.test(String(l.wave));
    const w = l.width || (isData ? (opts.dataWidth || 8) : 1);
    return { name: sigName(l), width: w, data: isData };
  });
  const uniq = [...new Map(ports.map(p => [p.name, p])).values()].filter(p => p.name !== reset);
  const props = [], notes = [];
  (wj.edge || []).forEach((raw, k) => {
    const e = parseEdge(String(raw));
    if (!e) { notes.push(`// skipped edge "${raw}": cannot parse`); return; }
    const a = nodes[e.from], c = nodes[e.to];
    if (!a || !c) { notes.push(`// skipped edge "${raw}": node ${!a ? e.from : e.to} not found in any lane's "node" string`); return; }
    let A = eventExpr(real[a.lane], a.wi), C = eventExpr(real[c.lane], c.wi);
    let d = c.slot - a.slot;
    let tm = timing(e.label, d);
    const nm = (tm.text ? tm.text.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') : '') || `${e.from}_to_${e.to}`;
    const pname = `p_${k}_${nm}`.slice(0, 60);
    const cmt = `// edge "${raw}": ${sigName(real[a.lane])}@slot${a.slot} -> ${sigName(real[c.lane])}@slot${c.slot}  (delta = ${d} cycle${Math.abs(d) === 1 ? '' : 's'})`;
    if (!e.directed && !e.both) {
      const seq = d >= 0 ? `${A} ${tm.range || '##0'} ${C}` : `${C} ##${-d} ${A}`;
      props.push(`${cmt}\n  c_${pname.slice(2)}: cover property (@(${edgeKw} ${clock})${dis} ${seq});`);
      return;
    }
    if (d < 0 && !/##\[/.test(tm.range)) {
      props.push(`${cmt}\n  // target precedes source: checked backwards with $past\n  a_${pname.slice(2)}: assert property (@(${edgeKw} ${clock})${dis} ${C} |-> $past(${A}, ${-d}))\n    else $error("[${nm}] ${C.replace(/"/g, "'")} without ${A.replace(/"/g, "'")} ${-d} cycle(s) earlier");`);
      return;
    }
    const imp = tm.range ? `|-> ${tm.range} ${C}` : `|-> ${C}`;
    props.push(`${cmt}\n  a_${pname.slice(2)}: assert property (@(${edgeKw} ${clock})${dis} ${A} ${imp})\n    else $error("[${nm}] expected ${C.replace(/"/g, "'")} ${tm.range ? tm.range.replace('##', '') + ' cycle(s) ' : ''}after ${A.replace(/"/g, "'")}");`);
    props.push(`c_${pname.slice(2)}: cover property (@(${edgeKw} ${clock})${dis} ${A} ${tm.range || '##0'} ${C});`);
    if (e.both && d > 0 && tm.n != null) props.push(`a_${pname.slice(2)}_rev: assert property (@(${edgeKw} ${clock})${dis} ${C} |-> $past(${A}, ${d}))\n    else $error("[${nm}] ${C.replace(/"/g, "'")} without matching ${A.replace(/"/g, "'")}");`);
  });
  const portDecl = [`input logic ${clock}`].concat(reset ? [`input logic ${reset}`] : []).concat(uniq.map(p => `input logic ${p.width > 1 ? `[${p.width - 1}:0] ` : ''}${p.name}`));
  const sv = `// Generated by 10xEngineers EDA from a WaveDrom timing diagram.
// Delays are exact clock-cycle distances between the diagram's nodes; add a label such as "[1:3]" to an edge for a window.
// Bind it to your design, e.g.:  bind <dut_module> ${opts.module} u_${opts.module} (.*);
module ${opts.module} (
  ${portDecl.join(',\n  ')}
);
${notes.length ? '  ' + notes.join('\n  ') + '\n' : ''}  ${props.join('\n\n  ') || '// no edges between nodes: add "node" letters to lanes and an "edge" list, e.g. "a~>b"'}
endmodule
`;
  return { sv, count: props.filter(p => /assert property/.test(p)).length, covers: props.filter(p => /cover property/.test(p)).length, clock, reset, nodes: Object.keys(nodes).length };
}

/* ------------------------------------------------------------------ SVG renderer */
function escX(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renderSvg(wj, theme) {
  const T = Object.assign({ fg: '#d4d4d4', muted: '#9d9d9d', bg: 'transparent', line: '#38bdf8', data: 'rgba(56,189,248,0.18)', x: 'rgba(239,68,68,0.25)', edge: '#f472b6', node: '#facc15' }, theme || {});
  const lanes = flattenLanes(wj.signal);
  const hs = Math.max(0.5, Number(wj.config && wj.config.hscale) || 1);
  const SW = 40 * hs, LH = 32, NAMEW = Math.max(60, 8 * Math.max(4, ...lanes.map(l => String(l.name || '').length + (l.group ? l.group.length + 1 : 0)))) + 16;
  const maxSlots = Math.max(1, ...lanes.map(l => expandLane(l).slots.length));
  const W = NAMEW + maxSlots * SW + 20;
  const headH = wj.head && wj.head.text ? 28 : 6;
  const H = headH + lanes.length * LH + 24 + (wj.foot && wj.foot.text ? 24 : 0);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Consolas, Menlo, monospace" font-size="12">`);
  parts.push(`<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${T.edge}"/></marker></defs>`);
  if (T.bg !== 'transparent') parts.push(`<rect width="100%" height="100%" fill="${T.bg}"/>`);
  if (wj.head && wj.head.text) parts.push(`<text x="${W / 2}" y="18" text-anchor="middle" fill="${T.fg}" font-weight="bold" font-size="14">${escX(wj.head.text)}</text>`);
  // grid
  for (let i = 0; i <= maxSlots; i++) parts.push(`<line x1="${NAMEW + i * SW}" y1="${headH}" x2="${NAMEW + i * SW}" y2="${headH + lanes.length * LH}" stroke="${T.muted}" stroke-opacity="0.15"/>`);
  for (let i = 0; i < maxSlots; i++) parts.push(`<text x="${NAMEW + i * SW + SW / 2}" y="${H - 8 - (wj.foot && wj.foot.text ? 24 : 0)}" text-anchor="middle" fill="${T.muted}" font-size="9">${i}</text>`);
  const nodePos = {};
  lanes.forEach((ln, li) => {
    const y0 = headH + li * LH + 6, y1 = y0 + LH - 12, ym = (y0 + y1) / 2;
    parts.push(`<text x="${NAMEW - 8}" y="${ym + 4}" text-anchor="end" fill="${T.fg}">${escX((ln.group ? ln.group + '.' : '') + (ln.name || ''))}</text>`);
    if (ln.wave == null) return;
    const ex = expandLane(ln);
    const ph = (Number(ln.phase) || 0) * SW;
    let prevK = null;
    ex.slots.forEach((st, i) => {
      const xa = NAMEW + i * SW - ph, xb = xa + SW;
      if (xb < NAMEW) return;
      const tr = st.start ? 4 : 0;
      if (st.k === 'clk') {
        const hi = y0, lo = y1, mid = xa + SW / 2;
        const p = st.pos;
        parts.push(`<path d="M${xa},${p ? lo : hi} L${xa},${p ? hi : lo} L${mid},${p ? hi : lo} L${mid},${p ? lo : hi} L${xb},${p ? lo : hi}" fill="none" stroke="${T.line}" stroke-width="1.5"/>`);
        if (/[PN]/.test(st.raw || '') && st.start) parts.push(`<path d="M${xa - 4},${ym + (p ? 4 : -4)} L${xa},${ym + (p ? -2 : 2)} L${xa + 4},${ym + (p ? 4 : -4)}" fill="none" stroke="${T.line}" stroke-width="1.5"/>`);
      } else if (st.k === '1' || st.k === '0') {
        const y = st.k === '1' ? y0 : y1;
        if (st.start && prevK && prevK !== st.k) parts.push(`<line x1="${xa}" y1="${y0}" x2="${xa}" y2="${y1}" stroke="${T.line}" stroke-width="1.5"/>`);
        parts.push(`<line x1="${xa}" y1="${y}" x2="${xb}" y2="${y}" stroke="${T.line}" stroke-width="1.5"/>`);
      } else if (st.k === 'z') {
        parts.push(`<line x1="${xa}" y1="${ym}" x2="${xb}" y2="${ym}" stroke="#f59e0b" stroke-width="1.5"/>`);
      } else {
        const fill = st.k === 'x' ? T.x : T.data;
        const l = st.start ? xa + tr : xa, r = (ex.slots[i + 1] && ex.slots[i + 1].start) || i === ex.slots.length - 1 ? xb - tr : xb;
        parts.push(`<path d="M${xa},${ym} ${st.start ? `L${l},${y0}` : `M${xa},${y0}`} L${r},${y0} L${xb},${ym} L${r},${y1} L${l},${y1} Z" fill="${fill}" stroke="none"/>`);
        parts.push(`<path d="${st.start ? `M${xa},${ym} L${l},${y0}` : `M${xa},${y0}`} L${r},${y0} ${r !== xb ? `L${xb},${ym} L${r},${y1}` : `M${xb},${y1}`} L${l},${y1} ${st.start ? `L${xa},${ym}` : ''}" fill="none" stroke="${st.k === 'x' ? '#ef4444' : T.line}" stroke-width="1.2"/>`);
        if (st.start && st.k === 'd' && st.label) {
          let run = 1; while (ex.slots[i + run] && !ex.slots[i + run].start) run++;
          parts.push(`<text x="${xa + run * SW / 2}" y="${ym + 4}" text-anchor="middle" fill="${T.fg}">${escX(st.label)}</text>`);
        }
      }
      prevK = st.k;
    });
    if (ln.node) String(ln.node).split('').forEach((ch, i) => {
      if (ch === '.' || ch === ' ') return;
      const x = NAMEW + i * ex.period * SW - ph, y = ym;
      nodePos[ch] = { x, y };
      parts.push(`<circle cx="${x}" cy="${y}" r="3" fill="${T.node}"/>${/[a-z]/i.test(ch) ? `<text x="${x + 4}" y="${y - 6}" fill="${T.node}" font-size="10">${escX(ch)}</text>` : ''}`);
    });
  });
  (wj.edge || []).forEach(raw => {
    const e = parseEdge(String(raw)); if (!e) return;
    const a = nodePos[e.from], b = nodePos[e.to]; if (!a || !b) return;
    let d;
    if (/~/.test(e.shape)) { const mx = (a.x + b.x) / 2; d = `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`; }
    else if (/^-\|-?/.test(e.shape.replace('<', ''))) d = `M${a.x},${a.y} L${b.x},${a.y} L${b.x},${b.y}`;
    else if (/^\|-/.test(e.shape.replace('<', ''))) d = `M${a.x},${a.y} L${a.x},${b.y} L${b.x},${b.y}`;
    else d = `M${a.x},${a.y} L${b.x},${b.y}`;
    parts.push(`<path d="${d}" fill="none" stroke="${T.edge}" stroke-width="1.3"${e.directed ? ' marker-end="url(#arr)"' : ''}${e.both ? ' marker-start="url(#arr)"' : ''}/>`);
    if (e.label) parts.push(`<text x="${(a.x + b.x) / 2 + 3}" y="${(a.y + b.y) / 2 - 4}" fill="${T.edge}" font-size="10">${escX(e.label)}</text>`);
  });
  if (wj.foot && wj.foot.text) parts.push(`<text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="${T.muted}">${escX(wj.foot.text)}</text>`);
  parts.push('</svg>');
  return parts.join('');
}

/* ================================================================== VS Code integration */
function register(context, deps) {
  const vscode = require('vscode');
  const path = require('path');
  const fs = require('fs');
  const sub = d => context.subscriptions.push(d);
  let panel = null, srcUri = null;
  const isWave = doc => doc && (/\.(wavedrom|wdjson|json5?)$/i.test(doc.fileName) || doc.languageId === 'markdown') && /["']?signal["']?\s*:/.test(doc.getText());
  const textOf = ed => {
    if (!ed) return null;
    const selText = ed.selection && !ed.selection.isEmpty ? ed.document.getText(ed.selection) : null;
    return selText || ed.document.getText();
  };
  const push = (text, fileName) => {
    if (!panel) return;
    try {
      const wj = parseWaveJson(text);
      const base = path.basename(fileName || 'timing').replace(/\.[^.]+$/, '').replace(/[^\w]/g, '_') || 'timing';
      const sva = generateSva(wj, { module: (wj.config && wj.config.sva && wj.config.sva.module) || base + '_sva' });
      panel.webview.postMessage({ type: 'render', svg: renderSvg(wj), sva: sva.sv, stats: `${sva.count} assertion(s) · ${sva.covers} cover(s) · ${sva.nodes} node(s) · clock ${sva.clock}${sva.reset ? ' · reset ' + sva.reset : ''}`, module: (wj.config && wj.config.sva && wj.config.sva.module) || base + '_sva' });
    } catch (e) { panel.webview.postMessage({ type: 'error', message: String(e.message || e) }); }
  };
  const open = async uri => {
    let doc;
    if (uri instanceof vscode.Uri) doc = await vscode.workspace.openTextDocument(uri);
    const ed = vscode.window.activeTextEditor;
    if (!doc && ed) doc = ed.document;
    if (!doc) { vscode.window.showWarningMessage('Open a WaveDrom JSON file (.wavedrom / .json with a "signal" array) or select a WaveJSON block.'); return; }
    srcUri = doc.uri;
    if (!panel) {
      panel = vscode.window.createWebviewPanel('tenxDebug.wavedrom', 'WaveDrom: ' + path.basename(doc.fileName), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
      panel.onDidDispose(() => { panel = null; });
      panel.webview.onDidReceiveMessage(async m => {
        if (m.type === 'copy') { await vscode.env.clipboard.writeText(m.text); vscode.window.setStatusBarMessage('SVA copied', 2500); }
        if (m.type === 'saveSv' || m.type === 'saveSvg') {
          const ext = m.type === 'saveSv' ? 'sv' : 'svg';
          const def = vscode.Uri.file(path.join(path.dirname(srcUri.fsPath), (m.type === 'saveSv' ? m.module : path.basename(srcUri.fsPath).replace(/\.[^.]+$/, '')) + '.' + ext));
          const to = await vscode.window.showSaveDialog({ defaultUri: def, filters: { [ext.toUpperCase()]: [ext] } });
          if (!to) return;
          fs.writeFileSync(to.fsPath, m.text, 'utf8');
          vscode.window.showInformationMessage(`Saved ${path.basename(to.fsPath)}`, 'Open').then(c => { if (c) vscode.window.showTextDocument(to); });
        }
      });
      const n = deps.nonce();
      panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${deps.csp(panel.webview, n)}">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);margin:0;padding:10px}
.bar{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:4px 10px;border-radius:3px;cursor:pointer}
#svg{overflow:auto;border:1px solid var(--vscode-panel-border);border-radius:4px;padding:6px}#svg svg text{fill:var(--vscode-editor-foreground)}
pre{background:var(--vscode-textCodeBlock-background);padding:8px;border-radius:4px;overflow:auto;font-family:var(--vscode-editor-font-family);font-size:12px}
.muted{color:var(--vscode-descriptionForeground)}.err{color:#ef4444}</style></head><body>
<div class="bar"><b>Timing diagram</b><span class="muted" id="stats"></span><span style="flex:1"></span><button id="bSvg">Save SVG</button><button id="bCopy">Copy SVA</button><button id="bSv">Export .sv</button></div>
<div id="svg"></div><h4>Generated SystemVerilog assertions</h4><pre id="sva"></pre><div class="muted">Delays come from node positions (one cycle per wave character × period). Edge label "[1:3]", "1..3", "##2", "&lt;=4" or "$" overrides the delay. Undirected edges (a~b) become cover properties.</div>
<script nonce="${n}">const vs=acquireVsCodeApi();let cur={};window.addEventListener('message',e=>{const m=e.data;if(m.type==='render'){cur=m;document.getElementById('svg').innerHTML=m.svg;document.getElementById('sva').textContent=m.sva;document.getElementById('stats').textContent=m.stats;}else if(m.type==='error'){document.getElementById('stats').innerHTML='<span class="err">'+m.message.replace(/</g,'&lt;')+'</span>';}});
document.getElementById('bCopy').onclick=()=>vs.postMessage({type:'copy',text:cur.sva||''});document.getElementById('bSv').onclick=()=>vs.postMessage({type:'saveSv',text:cur.sva||'',module:cur.module});document.getElementById('bSvg').onclick=()=>vs.postMessage({type:'saveSvg',text:cur.svg||''});</script></body></html>`;
    } else panel.reveal(vscode.ViewColumn.Beside, true);
    const ed2 = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
    push(ed2 ? textOf(ed2) : doc.getText(), doc.fileName);
  };
  sub(vscode.commands.registerCommand('tenxDebug.wavedrom.preview', open));
  sub(vscode.commands.registerCommand('tenxDebug.wavedrom.exportSva', async uri => {
    const doc = uri instanceof vscode.Uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
    if (!doc) return;
    try {
      const wj = parseWaveJson(textOf(vscode.window.activeTextEditor) || doc.getText());
      const base = path.basename(doc.fileName).replace(/\.[^.]+$/, '').replace(/[^\w]/g, '_');
      const r = generateSva(wj, { module: base + '_sva' });
      const out = vscode.Uri.file(path.join(path.dirname(doc.fileName), base + '_sva.sv'));
      fs.writeFileSync(out.fsPath, r.sv, 'utf8');
      vscode.window.showInformationMessage(`Wrote ${path.basename(out.fsPath)}: ${r.count} assertion(s), ${r.covers} cover(s).`, 'Open').then(c => { if (c) vscode.window.showTextDocument(out); });
    } catch (e) { vscode.window.showErrorMessage('WaveDrom: ' + e.message); }
  }));
  const refresh = (() => { let t; return doc => { clearTimeout(t); t = setTimeout(() => { if (panel && srcUri && doc.uri.toString() === srcUri.toString()) push(doc.getText(), doc.fileName); }, 300); }; })();
  sub(vscode.workspace.onDidChangeTextDocument(e => refresh(e.document)));
  sub(vscode.languages.registerCodeLensProvider([{ pattern: '**/*.{wavedrom,wdjson,json,json5}' }], {
    provideCodeLenses(doc) {
      if (!isWave(doc)) return [];
      const r = new vscode.Range(0, 0, 0, 0);
      return [new vscode.CodeLens(r, { title: '▶ WaveDrom preview + SVA', command: 'tenxDebug.wavedrom.preview', arguments: [doc.uri] }), new vscode.CodeLens(r, { title: '⇩ Export assertions (.sv)', command: 'tenxDebug.wavedrom.exportSva', arguments: [doc.uri] })];
    }
  }));
}

module.exports = { register, parseWaveJson, generateSva, renderSvg, flattenLanes, expandLane, parseEdge, eventExpr };

'use strict';
/*
 * UVM architecture diagram (opened from the "UVM Verification Hierarchy" view).
 *   buildModel(index, uvm, test)  pure data: components, ports, TLM connections, sequences, phases, config_db
 *   show(context, h, index, uvm, test)  webview with Architecture / Phases / Connections / config_db tabs
 * Everything is derived from the parsed sources (src/uvm.js), so it works for any UVM testbench in the workspace.
 */
const path = require('path');
const fs = require('fs');

const ROLES = [
  ['test', 'uvm_test'], ['env', 'uvm_env'], ['agent', 'uvm_agent'], ['sequencer', 'uvm_sequencer'], ['driver', 'uvm_driver'],
  ['monitor', 'uvm_monitor'], ['scoreboard', 'uvm_scoreboard'], ['subscriber', 'uvm_subscriber'], ['predictor', 'uvm_reg_predictor']
];
const PHASES = [
  ['build_phase', 'function', 'top-down: create children, get config'],
  ['connect_phase', 'function', 'bottom-up: connect TLM ports'],
  ['end_of_elaboration_phase', 'function', 'topology is final'],
  ['start_of_simulation_phase', 'function', 'last setup before time 0'],
  ['run_phase', 'task', 'consumes time; all components in parallel'],
  ['pre_reset_phase', 'task', ''], ['reset_phase', 'task', ''], ['post_reset_phase', 'task', ''],
  ['pre_configure_phase', 'task', ''], ['configure_phase', 'task', ''], ['post_configure_phase', 'task', ''],
  ['pre_main_phase', 'task', ''], ['main_phase', 'task', ''], ['post_main_phase', 'task', ''],
  ['pre_shutdown_phase', 'task', ''], ['shutdown_phase', 'task', ''], ['post_shutdown_phase', 'task', ''],
  ['extract_phase', 'function', 'collect results'],
  ['check_phase', 'function', 'end-of-test checks'],
  ['report_phase', 'function', 'print results'],
  ['final_phase', 'function', 'close files']
];
const COMMON = new Set(['build_phase', 'connect_phase', 'end_of_elaboration_phase', 'start_of_simulation_phase', 'run_phase', 'extract_phase', 'check_phase', 'report_phase', 'final_phase']);

function portDir(type, name) {
  const t = String(type || '') + ' ' + String(name || '');
  if (/analysis_port|\bap\b|_ap$/.test(t)) return 'analysis';
  if (/imp\b|_imp|export/.test(t)) return 'target';
  return 'initiator';
}

function buildModel(ux, uvm, test) {
  const top = uvm.buildTopology(ux, test);
  const nodes = {};
  const order = [];
  // typedef'd components (e.g. typedef uvm_sequencer #(item) my_sequencer;) are not classes in the index: fall back to the name
  const NAME_ROLES = [[/sequencer|_sqr$/i, 'sequencer'], [/driver|_drv$/i, 'driver'], [/monitor|_mon$/i, 'monitor'], [/scoreboard|_sb$|_scb$/i, 'scoreboard'], [/coverage|_cov$|subscriber/i, 'subscriber'], [/agent|_agt$/i, 'agent'], [/env$/i, 'env']];
  const roleOf = type => {
    for (const [r, base] of ROLES) if (uvm.isA(ux, type, base)) return r;
    if (!ux.classes.has(type)) for (const [re, r] of NAME_ROLES) if (re.test(type)) return r;
    return 'component';
  };
  const ref = c => (c ? { uri: c.uri, line: c.line } : null);
  (function walk(n, parent) {
    nodes[n.path] = {
      id: n.path, inst: n.inst, type: n.type, role: roleOf(n.type), parent, children: n.children.map(c => c.path),
      cls: ref(n.cls), overridden: !!n.overridden, origType: n.origType || null,
      ports: n.ports.filter((p, i, a) => a.findIndex(q => q.name === p.name) === i).map(p => ({ name: p.name, type: p.type, dir: portDir(p.type, p.name), line: p.line }))
    };
    order.push(n.path);
    n.children.forEach(c => walk(c, n.path));
  })(top, null);

  // TLM connections, resolved to absolute component paths (ports inherited from UVM base classes are implied)
  const conns = [];
  const seen = new Set();
  (function walk(n) {
    for (const c of n.connects) {
      const abs = s => (n.path + '.' + s).split('.');
      const f = abs(c.from), t = abs(c.to);
      const fo = f.slice(0, -1).join('.'), to = t.slice(0, -1).join('.');
      if (!nodes[fo] || !nodes[to]) continue;
      const key = fo + '.' + f[f.length - 1] + '>' + to + '.' + t[t.length - 1];
      if (seen.has(key)) continue;
      seen.add(key);
      const fp = f[f.length - 1], tp = t[t.length - 1];
      if (!nodes[fo].ports.some(p => p.name === fp)) nodes[fo].ports.push({ name: fp, type: '(inherited)', dir: portDir('', fp), implied: true });
      if (!nodes[to].ports.some(p => p.name === tp)) nodes[to].ports.push({ name: tp, type: '(inherited)', dir: portDir('', tp), implied: true });
      const declaring = [n.type, ...uvm.ancestors(ux, n.type)].map(x => ux.classes.get(x)).find(k => k && k.connects.some(x => x.from === c.from && x.to === c.to));
      conns.push({ from: { node: fo, port: fp }, to: { node: to, port: tp }, in: n.path, inType: n.type, src: declaring ? { uri: declaring.uri, line: c.line } : ref(n.cls), kind: /seq_item/.test(fp + tp) ? 'seq_item' : 'analysis' });
    }
    n.children.forEach(walk);
  })(top);

  // sequences started by the test (and its base classes)
  // a start() inside a method that a more-derived test overrides never runs for this test
  const seqs = [];
  const chain = [test, ...uvm.ancestors(ux, test)];
  const methodAt = (c, line) => c.methods.filter(x => x.line <= line).sort((a, b) => b.line - a.line)[0];
  chain.forEach((cn, depth) => {
    const c = ux.classes.get(cn);
    if (!c) return;
    for (const s of c.starts || []) {
      const meth = methodAt(c, s.line);
      if (meth && chain.slice(0, depth).some(d => { const k = ux.classes.get(d); return k && k.methods.some(x => x.name === meth.name); })) continue;
      const cr = c.creates.filter(x => x.var === s.var && x.line <= s.line).sort((a, b) => b.line - a.line)[0] || c.creates.find(x => x.var === s.var);
      const type = cr ? cr.type : (c.vars[s.var] || s.var);
      const target = 'uvm_test_top.' + s.target.replace(/^this\./, '');
      if (seqs.some(x => x.type === type && x.target === target)) continue;
      seqs.push({ type, inst: cr ? cr.inst : s.var, target: nodes[target] ? target : null, targetText: s.target, in: cn + (meth ? '::' + meth.name : ''), src: { uri: c.uri, line: s.line } });
    }
  });

  // phases implemented per component type (own or inherited from a workspace base class)
  const types = [...new Set(order.map(id => nodes[id].type))];
  const phaseMap = {};
  for (const t of types) {
    phaseMap[t] = {};
    for (const cn of [t, ...uvm.ancestors(ux, t)]) {
      const c = ux.classes.get(cn);
      if (!c) continue;
      for (const m of c.methods) if (/_phase$/.test(m.name) && !phaseMap[t][m.name]) phaseMap[t][m.name] = { cls: cn, inherited: cn !== t, uri: c.uri, line: m.line };
    }
  }
  const used = new Set(Object.values(phaseMap).flatMap(o => Object.keys(o)));
  const phases = PHASES.filter(([p]) => COMMON.has(p) || used.has(p)).map(([name, kind, note]) => ({ name, kind, note }));

  const rel = u => { try { return path.basename(decodeURIComponent(String(u).replace(/^file:\/\/\/?/, ''))); } catch (e) { return String(u); } };
  const cfg = {
    sets: ux.sets.map(s => ({ field: s.field, type: s.type, cntxt: s.cntxt, inst: s.inst, file: rel(s.uri), uri: s.uri, line: s.line, vif: /\bvirtual\b/.test(s.type) })),
    gets: ux.gets.map(g => ({ field: g.field, type: g.type, cntxt: g.cntxt, inst: g.inst, target: g.target, file: rel(g.uri), uri: g.uri, line: g.line }))
  };
  return { test, root: top.path, nodes, order, conns, seqs, phases, phaseMap, types, cfg, overrides: ux.overrides.length };
}

function show(context, h, ux, uvm, initial) {
  const vscode = require('vscode');
  const tests = uvm.tests(ux);
  if (!tests.length) { vscode.window.showInformationMessage('No uvm_test classes found in the workspace — open a folder with a UVM testbench.'); return; }
  const models = {};
  for (const t of tests) { try { models[t] = buildModel(ux, uvm, t); } catch (e) { /* skip broken */ } }
  const start = initial && models[initial] ? initial : (tests.find(t => !/base/i.test(t) && models[t]) || tests[0]);
  const panel = vscode.window.createWebviewPanel('tenxDebug.uvmArchitecture', 'UVM Architecture', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  const n = h.nonce();
  panel.webview.html = html(h.csp(panel.webview, n), n, { tests: Object.keys(models), models, start });
  panel.webview.onDidReceiveMessage(async m => {
    if (m.type === 'open' && m.uri) await h.revealLine(m.uri, m.line || 0);
    if (m.type === 'exportSvg') {
      const ws = (vscode.workspace.workspaceFolders || [])[0];
      const f = await vscode.window.showSaveDialog({ filters: { SVG: ['svg'] }, defaultUri: ws ? vscode.Uri.joinPath(ws.uri, (m.name || 'uvm_architecture') + '.svg') : undefined });
      if (f) { fs.writeFileSync(f.fsPath, m.svg); vscode.window.showInformationMessage('Saved ' + f.fsPath); }
    }
  });
  return panel;
}

function html(csp, nonce, data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
${csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ''}
<meta name="viewport" content="width=device-width, initial-scale=1"><title>UVM Architecture</title>
<style>${CSS}</style></head><body>
<div class="bar">
  <div class="ttl"><b>UVM architecture</b><select id="test" aria-label="Test"></select></div>
  <div class="tabs" id="tabs"><button data-tab="arch" class="on">Architecture</button><button data-tab="phases">Phases</button><button data-tab="conns">Connections</button><button data-tab="cfg">config_db</button></div>
  <div class="grow"></div>
  <div class="tools" id="tools"><button id="zin" title="Zoom in">+</button><button id="zout" title="Zoom out">−</button><button id="fit" title="Fit to window">Fit</button><button id="svg" title="Save as SVG">Export SVG</button></div>
</div>
<div class="view" id="v-arch"><div class="stage" id="stage"><svg id="dg" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="legend" id="legend"></div><div class="stats" id="stats"></div></div>
<div class="view page" id="v-phases" hidden></div>
<div class="view page" id="v-conns" hidden></div>
<div class="view page" id="v-cfg" hidden></div>
<script id="data" type="application/json">${json}</script>
<script nonce="${nonce}">${CLIENT}</script>
</body></html>`;
}

const CSS = String.raw`
:root{
  --bg:var(--vscode-editor-background,#1e1e1e);--fg:var(--vscode-foreground,#d4d4d4);--muted:var(--vscode-descriptionForeground,#9d9d9d);
  --line:var(--vscode-panel-border,#3c3c3c);--panel:var(--vscode-sideBar-background,#252526);--focus:var(--vscode-focusBorder,#007fd4);
  --btn:var(--vscode-button-background,#0e639c);--btn-fg:var(--vscode-button-foreground,#fff);
  --blue:var(--vscode-charts-blue,#3794ff);--green:var(--vscode-charts-green,#89d185);--orange:var(--vscode-charts-orange,#d18616);
  --purple:var(--vscode-charts-purple,#b180d7);--red:var(--vscode-charts-red,#f14c4c);--yellow:var(--vscode-charts-yellow,#cca700);
  --mono:var(--vscode-editor-font-family,Consolas,"Cascadia Mono",monospace);
}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:13px/1.45 var(--vscode-font-family,"Segoe UI",system-ui,sans-serif);overflow:hidden}
button,select{font:inherit;color:inherit}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--panel)}
.ttl{display:flex;align-items:center;gap:10px}
select{background:var(--vscode-dropdown-background,#3c3c3c);border:1px solid var(--vscode-dropdown-border,#3c3c3c);border-radius:3px;padding:3px 6px;font-family:var(--mono);font-size:12px}
.tabs{display:flex;gap:2px}
.tabs button,.tools button{background:transparent;border:1px solid transparent;border-radius:4px;padding:3px 10px;cursor:pointer;color:var(--muted)}
.tabs button:hover,.tools button:hover{color:var(--fg);border-color:var(--line)}
.tabs button.on{color:var(--fg);background:color-mix(in srgb,var(--blue) 20%,transparent);border-color:color-mix(in srgb,var(--blue) 50%,transparent)}
.tools{display:flex;gap:4px}
.grow{flex:1}
button:focus-visible,select:focus-visible{outline:1px solid var(--focus);outline-offset:1px}
.view{position:absolute;top:46px;left:0;right:0;bottom:0}
.view[hidden]{display:none}
.stage{position:absolute;inset:0;overflow:hidden;cursor:grab}
.stage.drag{cursor:grabbing}
svg#dg{width:100%;height:100%;display:block}
.legend{position:absolute;left:12px;bottom:10px;display:flex;flex-wrap:wrap;gap:4px 14px;padding:6px 10px;background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line);border-radius:6px;font-size:11.5px;color:var(--muted);max-width:calc(100% - 24px)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend svg{width:26px;height:14px}
.stats{position:absolute;right:12px;bottom:10px;font-size:11.5px;color:var(--muted);background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line);border-radius:6px;padding:6px 10px}
/* svg */
.box rect.b{stroke-width:1.4}
.box .nm{font-weight:600;font-size:13px;fill:var(--fg)}
.box .ty{font-family:var(--mono);font-size:11px;fill:var(--muted)}
.box .rl{font-size:10px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
.box{cursor:pointer}
.box:hover rect.b{stroke-width:2.4}
.r-test rect.b{fill:color-mix(in srgb,var(--purple) 7%,var(--bg));stroke:var(--purple)}.r-test .rl{fill:var(--purple)}
.r-env rect.b{fill:color-mix(in srgb,var(--blue) 7%,var(--bg));stroke:var(--blue)}.r-env .rl{fill:var(--blue)}
.r-agent rect.b{fill:color-mix(in srgb,var(--green) 7%,var(--bg));stroke:var(--green)}.r-agent .rl{fill:var(--green)}
.r-leaf rect.b{fill:var(--panel)}
.r-sequencer rect.b{stroke:var(--yellow)}.r-sequencer .rl{fill:var(--yellow)}
.r-driver rect.b{stroke:var(--orange)}.r-driver .rl{fill:var(--orange)}
.r-monitor rect.b{stroke:var(--blue)}.r-monitor .rl{fill:var(--blue)}
.r-scoreboard rect.b{stroke:var(--red)}.r-scoreboard .rl{fill:var(--red)}
.r-subscriber rect.b{stroke:var(--purple)}.r-subscriber .rl{fill:var(--purple)}
.r-component rect.b,.r-predictor rect.b{stroke:var(--muted)}.r-component .rl,.r-predictor .rl{fill:var(--muted)}
.ovr rect.b{stroke-dasharray:6 4}
.strip{stroke:none}
.port-i{fill:var(--fg)}.port-a{fill:var(--fg)}.port-t{fill:var(--bg);stroke:var(--fg);stroke-width:1.8}
.pl{font-family:var(--mono);font-size:10.5px;fill:var(--muted)}
.wire{fill:none;stroke-width:1.8;cursor:pointer}
.wire.seq_item{stroke:var(--orange)}.wire.analysis{stroke:var(--blue)}
.wire-hit{fill:none;stroke:transparent;stroke-width:12;cursor:pointer}
.ah-seq_item{fill:var(--orange)}.ah-analysis{fill:var(--blue)}.ah-dash{fill:var(--muted)}
.dash{fill:none;stroke:var(--muted);stroke-width:1.4;stroke-dasharray:5 4}
.seq rect{fill:color-mix(in srgb,var(--yellow) 12%,var(--bg));stroke:var(--yellow);stroke-dasharray:4 3}
.seq text{font-family:var(--mono);font-size:11px;fill:var(--fg)}
.seq{cursor:pointer}
.hdl rect.band{fill:color-mix(in srgb,var(--orange) 6%,var(--bg));stroke:var(--orange);stroke-width:1.2}
.hdl .nm{font-weight:600;font-size:13px;fill:var(--fg)}
.hdl .vif rect{fill:var(--panel);stroke:var(--orange)}
.hdl text.t{font-family:var(--mono);font-size:11px;fill:var(--fg)}
.hdl text.m{font-size:10.5px;fill:var(--muted)}
.dim{opacity:.18;transition:opacity .12s}
.hl .wire{stroke-width:3}
/* pages */
.page{overflow:auto;padding:16px 18px 40px}
.page h2{font-size:14px;margin:0 0 4px}
.page p.sub{color:var(--muted);margin:0 0 12px;font-size:12px}
table{border-collapse:collapse;font-size:12.5px;min-width:100%}
th,td{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top;white-space:nowrap}
thead th{position:sticky;top:-16px;background:var(--panel);font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
td.c{text-align:center}
.mono{font-family:var(--mono);font-size:12px}
.muted{color:var(--muted)}
a.lnk{color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;text-decoration:none}
a.lnk:hover{text-decoration:underline}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--green);cursor:pointer}
.dot.inh{background:transparent;border:2px solid var(--green)}
.tag{font-size:10.5px;padding:0 6px;border-radius:8px;border:1px solid var(--line);color:var(--muted)}
.tag.fn{color:var(--blue);border-color:var(--blue)}.tag.task{color:var(--orange);border-color:var(--orange)}
.warn{color:var(--orange)}
.sec{margin-top:26px}
`;

/* client: no backticks and no dollar-brace inside */
const CLIENT = String.raw`
(function(){
'use strict';
var DATA = JSON.parse(document.getElementById('data').textContent);
var vs = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
var SVGNS = 'http://www.w3.org/2000/svg';
function $(s){ return document.querySelector(s); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function open(ref){ if (ref && vs) vs.postMessage({ type: 'open', uri: ref.uri, line: ref.line }); }
var M = null, L = null, view = { x: 0, y: 0, k: 1 };
var RANK = { sequencer: 0, driver: 1, monitor: 2, subscriber: 3, predictor: 4, agent: 5, scoreboard: 6, env: 7, component: 8, test: 9 };
var CONTAINER = { test: 1, env: 1, agent: 1 };
var tw = function(s, px){ return String(s).length * (px || 7.1); };

/* ---------------------------------------------------------------- layout */
function layout(m){
  var P = {}; var PAD = 18, GAP = 30, HEAD = 46;
  function seqBand(id){ return id === m.root && m.seqs.length ? 46 : 0; }
  function measure(id){
    var n = m.nodes[id];
    var rk = function(k){ var r = RANK[m.nodes[k].role]; return r == null ? 8 : r; };
    var kids = n.children.slice().sort(function(a, b){ return rk(a) - rk(b); });
    var nP = n.ports.length;
    var leafW = Math.max(186, tw(n.type, 6.9) + 40, tw(n.inst, 8) + 90);
    // ports sit in a band under the name/type lines so their labels never overlap them
    if (!kids.length) { P[id] = { w: leafW, h: nP ? 108 + Math.max(0, nP - 1) * 20 : 78, kids: [] }; return P[id]; }
    kids.forEach(measure);
    var cols = kids.length <= 2 ? kids.length : kids.length <= 4 ? 2 : 3;
    var rows = []; for (var i = 0; i < kids.length; i += cols) rows.push(kids.slice(i, i + cols));
    var colW = []; rows.forEach(function(r){ r.forEach(function(k, c){ colW[c] = Math.max(colW[c] || 0, P[k].w); }); });
    var rowH = rows.map(function(r){ return Math.max.apply(null, r.map(function(k){ return P[k].h; })); });
    var innerW = colW.reduce(function(a, b){ return a + b; }, 0) + GAP * 1.6 * (colW.length - 1);
    var innerH = rowH.reduce(function(a, b){ return a + b; }, 0) + GAP * (rows.length - 1);
    var head = HEAD + seqBand(id);
    P[id] = { w: Math.max(innerW + 2 * PAD + 20, tw(n.inst + ' : ' + n.type, 7.4) + 120), h: head + innerH + PAD + 8, rows: rows, colW: colW, rowH: rowH, head: head, kids: kids };
    return P[id];
  }
  function place(id, x, y){
    var p = P[id]; p.x = x; p.y = y;
    if (!p.rows) return;
    var yy = y + p.head;
    p.rows.forEach(function(r, ri){
      var xx = x + PAD + 10;
      r.forEach(function(k, c){ place(k, xx + (p.colW[c] - P[k].w) / 2, yy + (p.rowH[ri] - P[k].h) / 2); xx += p.colW[c] + GAP * 1.6; });
      yy += p.rowH[ri] + GAP;
    });
  }
  measure(m.root); place(m.root, 20, 20);
  // ports: side chosen from the connections, then spread along each side
  var side = {};
  var key = function(n, p){ return n + '#' + p; };
  var ctr = function(id){ var p = P[id]; return { x: p.x + p.w / 2, y: p.y + p.h / 2 }; };
  m.conns.forEach(function(c){
    var a = ctr(c.from.node), b = ctr(c.to.node);
    var horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) * 0.6;
    var sf = horiz ? (b.x >= a.x ? 'r' : 'l') : (b.y >= a.y ? 'b' : 't');
    var st = { r: 'l', l: 'r', b: 't', t: 'b' }[sf];
    if (!side[key(c.from.node, c.from.port)]) side[key(c.from.node, c.from.port)] = sf;
    if (!side[key(c.to.node, c.to.port)]) side[key(c.to.node, c.to.port)] = st;
  });
  var PP = {};
  m.order.forEach(function(id){
    var n = m.nodes[id], p = P[id];
    var by = { l: [], r: [], t: [], b: [] };
    n.ports.forEach(function(pt){ var s = side[key(id, pt.name)] || (pt.dir === 'target' ? 'l' : 'r'); by[s].push(pt); });
    ['l', 'r'].forEach(function(s){ by[s].forEach(function(pt, i){ var top = p.rows ? p.y + p.head : p.y + 80; var bot = p.y + p.h - 10; var yy = by[s].length === 1 ? (p.rows ? p.y + p.head - 14 : p.y + p.h - 18) : top + (bot - top) * (i + 0.5) / by[s].length; PP[key(id, pt.name)] = { x: s === 'l' ? p.x : p.x + p.w, y: yy, side: s, pt: pt }; }); });
    ['t', 'b'].forEach(function(s){ by[s].forEach(function(pt, i){ var xx = p.x + p.w * (i + 1) / (by[s].length + 1); PP[key(id, pt.name)] = { x: xx, y: s === 't' ? p.y : p.y + p.h, side: s, pt: pt }; }); });
  });
  var rootP = P[m.root];
  var vifs = m.cfg.sets.filter(function(s){ return s.vif; });
  var hdl = vifs.length ? { x: rootP.x, y: rootP.y + rootP.h + 70, w: rootP.w, h: 92 } : null;
  return { P: P, PP: PP, key: key, hdl: hdl, vifs: vifs, W: rootP.w + 40, H: rootP.h + 40 + (hdl ? hdl.h + 70 : 0) };
}

/* ---------------------------------------------------------------- render */
function el(tag, attrs, parent){ var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function txt(parent, x, y, s, cls, anchor){ var t = el('text', { x: x, y: y, 'class': cls || '' }, parent); if (anchor) t.setAttribute('text-anchor', anchor); t.textContent = s; return t; }
function title(parent, s){ var t = el('title', {}, parent); t.textContent = s; }
/* does the horizontal segment y, x1..x2 cross a leaf box other than the excluded ones? */
function crossesLeaf(y, x1, x2, skip){
  var lo = Math.min(x1, x2), hi = Math.max(x1, x2);
  return M.order.some(function(id){
    if (skip.indexOf(id) >= 0 || M.nodes[id].children.length) return false;
    var p = L.P[id];
    return y > p.y && y < p.y + p.h && hi > p.x && lo < p.x + p.w;
  });
}
function route(a, b, fromId, toId){
  var d = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };
  var s = 16, a2 = { x: a.x + d[a.side][0] * s, y: a.y + d[a.side][1] * s }, b2 = { x: b.x + d[b.side][0] * s, y: b.y + d[b.side][1] * s };
  var hz = a.side === 'l' || a.side === 'r';
  var mid;
  // the vertical leg runs in the gap just before the target, which is free of sibling boxes
  if (hz && (b.side === 'l' || b.side === 'r')) {
    mid = b.side === 'l' ? b.x - 22 : b.x + 22;
    if ((a.side === 'r' && mid < a.x + 10) || (a.side === 'l' && mid > a.x - 10)) mid = (a2.x + b2.x) / 2;
    if (fromId && crossesLeaf(a.y, a.x, mid, [fromId, toId])) {
      // detour: step out of the source, rise into the gap above its row, then run across
      var cy = L.P[fromId].y - 14;
      return 'M' + a.x + ' ' + a.y + ' H' + a2.x + ' V' + cy + ' H' + mid + ' V' + b.y + ' H' + (b.x + d[b.side][0] * 9);
    }
    return 'M' + a.x + ' ' + a.y + ' H' + mid + ' V' + b.y + ' H' + (b.x + d[b.side][0] * 9); }
  if (!hz && (b.side === 't' || b.side === 'b')) { mid = (a2.y + b2.y) / 2; return 'M' + a.x + ' ' + a.y + ' V' + mid + ' H' + b.x + ' V' + (b.y + d[b.side][1] * 9); }
  if (hz) return 'M' + a.x + ' ' + a.y + ' H' + b.x + ' V' + (b.y + d[b.side][1] * 9);
  return 'M' + a.x + ' ' + a.y + ' V' + b.y + ' H' + (b.x + d[b.side][0] * 9);
}
function render(){
  var m = M, svg = $('#dg');
  L = layout(m);
  svg.innerHTML = '';
  var defs = el('defs', {}, svg);
  ['seq_item', 'analysis', 'dash'].forEach(function(k){ var mk = el('marker', { id: 'ah-' + k, viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, defs); el('path', { d: 'M0 0 L10 5 L0 10 Z', 'class': 'ah-' + k }, mk); });
  var g = el('g', { id: 'vp' }, svg);
  var gBoxes = el('g', {}, g), gWires = el('g', {}, g), gPorts = el('g', {}, g), gOver = el('g', {}, g);
  m.order.forEach(function(id){
    var n = m.nodes[id], p = L.P[id], container = !!p.rows;
    var cls = 'box r-' + (container ? n.role : 'leaf') + ' r-' + n.role + (n.overridden ? ' ovr' : '');
    var b = el('g', { 'class': cls, 'data-id': id }, gBoxes);
    el('rect', { 'class': 'b', x: p.x, y: p.y, width: p.w, height: p.h, rx: container ? 8 : 6 }, b);
    if (!container) el('rect', { 'class': 'strip', x: p.x + 1, y: p.y + 1, width: p.w - 2, height: 4, rx: 2, fill: 'currentColor', style: 'color:var(--' + ({ sequencer: 'yellow', driver: 'orange', monitor: 'blue', scoreboard: 'red', subscriber: 'purple' }[n.role] || 'muted') + ')' }, b);
    txt(b, p.x + 14, p.y + (container ? 22 : 26), n.role.toUpperCase() + (n.overridden ? '  ·  OVERRIDE' : ''), 'rl');
    var nm = txt(b, p.x + 14, p.y + (container ? 38 : 44), n.inst, 'nm');
    if (container) { var t2 = el('tspan', { 'class': 'ty', dx: '8' }, nm); t2.textContent = ': ' + n.type; }
    else txt(b, p.x + 14, p.y + 62, n.type, 'ty');
    title(b, n.id + '\n' + n.type + (n.overridden ? '\n(factory override of ' + n.origType + ')' : '') + '\nclick to open the class');
  });
  // sequences band in the test box
  var rp = L.P[m.root];
  var sx = rp.x + 20, sy = rp.y + 50, limit = rp.x + rp.w - 90, hidden = 0;
  m.seqs.forEach(function(s){
    var w = tw(s.type, 6.8) + 22;
    if (sx + w > limit) { hidden++; return; }
    var sg = el('g', { 'class': 'seq' }, gBoxes);
    el('rect', { x: sx, y: sy, width: w, height: 26, rx: 13 }, sg);
    txt(sg, sx + 11, sy + 17, s.type);
    title(sg, s.inst + ' : ' + s.type + '\nstarted on ' + s.targetText + ' in ' + s.in + '\nclick to open');
    sg.addEventListener('click', function(e){ e.stopPropagation(); open(s.src); });
    sx += w + 10;
  });
  if (hidden) { var mt = txt(gBoxes, sx + 2, sy + 17, '+' + hidden + ' more', 'pl'); title(mt, m.seqs.slice(m.seqs.length - hidden).map(function(s){ return s.type; }).join('\n')); }
  // one arrow per target sequencer: from the sequence band straight down to the sequencer
  m.seqs.map(function(s){ return s.target; }).filter(function(t, i, a){ return t && L.P[t] && a.indexOf(t) === i; }).forEach(function(t){
    var tp = L.P[t], cx = tp.x + tp.w / 2;
    var sp = el('path', { 'class': 'dash', d: 'M' + cx + ' ' + (sy + 30) + ' V' + (tp.y - 3), 'marker-end': 'url(#ah-dash)' }, gWires);
    title(sp, 'seq.start(' + t.replace(/^uvm_test_top\./, '') + ')');
  });
  // wires
  m.conns.forEach(function(c, i){
    var a = L.PP[L.key(c.from.node, c.from.port)], b = L.PP[L.key(c.to.node, c.to.port)];
    if (!a || !b) return;
    var d = route(a, b, c.from.node, c.to.node);
    var w = el('g', { 'class': 'wg', 'data-from': c.from.node, 'data-to': c.to.node }, gWires);
    el('path', { 'class': 'wire ' + c.kind, d: d, 'marker-end': 'url(#ah-' + c.kind + ')' }, w);
    var hit = el('path', { 'class': 'wire-hit', d: d }, w);
    title(hit, c.from.node.replace(/^uvm_test_top\./, '') + '.' + c.from.port + '  →  ' + c.to.node.replace(/^uvm_test_top\./, '') + '.' + c.to.port + '\nconnected in ' + c.inType + '.connect_phase — click to open');
    hit.addEventListener('click', function(e){ e.stopPropagation(); open(c.src); });
  });
  // ports
  Object.keys(L.PP).forEach(function(k){
    var q = L.PP[k], pt = q.pt;
    var pg = el('g', {}, gPorts);
    if (pt.dir === 'target') el('circle', { cx: q.x, cy: q.y, r: 6, 'class': 'port-t' }, pg);
    else if (pt.dir === 'analysis') el('path', { d: 'M' + q.x + ' ' + (q.y - 7) + ' L' + (q.x + 7) + ' ' + q.y + ' L' + q.x + ' ' + (q.y + 7) + ' L' + (q.x - 7) + ' ' + q.y + ' Z', 'class': 'port-a' }, pg);
    else el('rect', { x: q.x - 5.5, y: q.y - 5.5, width: 11, height: 11, 'class': 'port-i' }, pg);
    var lx = q.side === 'l' ? q.x + 11 : q.side === 'r' ? q.x - 11 : q.x + 9, ly = q.side === 't' ? q.y + 16 : q.side === 'b' ? q.y - 8 : q.y - 8;
    txt(pg, lx, ly, pt.name, 'pl', q.side === 'r' ? 'end' : 'start');
    title(pg, pt.name + ' : ' + pt.type);
  });
  // HDL top with virtual interfaces
  if (L.hdl) {
    var hb = el('g', { 'class': 'hdl' }, gOver), H = L.hdl;
    el('rect', { 'class': 'band', x: H.x, y: H.y, width: H.w, height: H.h, rx: 8 }, hb);
    txt(hb, H.x + 14, H.y + 22, 'HDL top (static world)', 'nm');
    var vx = H.x + 14;
    L.vifs.forEach(function(v){
      var label = v.field + ' : ' + v.type, sub = 'set(' + v.cntxt + ', "' + v.inst + '") · ' + v.file + ':' + (v.line + 1), w = Math.max(tw(label, 6.8), tw(sub, 6.2)) + 28;
      var vg = el('g', { 'class': 'vif', style: 'cursor:pointer' }, hb);
      el('rect', { x: vx, y: H.y + 34, width: w, height: 44, rx: 5 }, vg);
      txt(vg, vx + 12, H.y + 52, label, 't');
      txt(vg, vx + 12, H.y + 69, sub, 'm');
      title(vg, 'uvm_config_db set — click to open');
      vg.addEventListener('click', function(){ open(v); });
      el('path', { 'class': 'dash', d: 'M' + (vx + w / 2) + ' ' + (H.y + 34) + ' V' + (rp.y + rp.h + 4), 'marker-end': 'url(#ah-dash)' }, gWires);
      txt(gOver, vx + w / 2 + 8, rp.y + rp.h + 40, 'config_db "' + v.field + '"', 'pl');
      vx += w + 16;
    });
  }
  // interactions
  Array.prototype.forEach.call(gBoxes.querySelectorAll('.box'), function(b){
    var id = b.getAttribute('data-id');
    b.addEventListener('click', function(e){ e.stopPropagation(); open(m.nodes[id].cls); });
    b.addEventListener('mouseenter', function(){ highlight(id); });
    b.addEventListener('mouseleave', function(){ highlight(null); });
  });
  $('#stats').textContent = m.order.length + ' components · ' + m.conns.length + ' TLM connections · ' + m.seqs.length + ' sequence(s) · ' + m.cfg.sets.length + ' config_db set(s)' + (m.overrides ? ' · ' + m.overrides + ' override(s)' : '');
  fit();
}
function highlight(id){
  var svg = $('#dg');
  Array.prototype.forEach.call(svg.querySelectorAll('.wg'), function(w){
    var on = !id || w.getAttribute('data-from').indexOf(id) === 0 || w.getAttribute('data-to').indexOf(id) === 0;
    w.classList.toggle('dim', !on); w.classList.toggle('hl', !!id && on);
  });
}

/* ---------------------------------------------------------------- pan / zoom */
function apply(){ var vp = $('#vp'); if (vp) vp.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')'); }
function fit(){
  var st = $('#stage').getBoundingClientRect();
  var k = Math.min((st.width - 30) / L.W, (st.height - 70) / L.H, 1.4);
  view.k = Math.max(0.2, k); view.x = (st.width - L.W * view.k) / 2; view.y = Math.max(10, (st.height - 50 - L.H * view.k) / 2);
  apply();
}
function zoom(f, cx, cy){
  var st = $('#stage').getBoundingClientRect();
  cx = cx == null ? st.width / 2 : cx; cy = cy == null ? st.height / 2 : cy;
  var k = Math.max(0.15, Math.min(4, view.k * f));
  view.x = cx - (cx - view.x) * k / view.k; view.y = cy - (cy - view.y) * k / view.k; view.k = k; apply();
}
(function(){
  var stage = $('#stage'), drag = null;
  stage.addEventListener('wheel', function(e){ e.preventDefault(); var r = stage.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  stage.addEventListener('mousedown', function(e){ if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; stage.classList.add('drag'); });
  window.addEventListener('mousemove', function(e){ if (!drag) return; view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y; apply(); });
  window.addEventListener('mouseup', function(){ drag = null; stage.classList.remove('drag'); });
  window.addEventListener('resize', function(){ if (!$('#v-arch').hidden) fit(); });
  $('#zin').addEventListener('click', function(){ zoom(1.2); });
  $('#zout').addEventListener('click', function(){ zoom(1 / 1.2); });
  $('#fit').addEventListener('click', fit);
  $('#svg').addEventListener('click', function(){
    var svg = $('#dg').cloneNode(true);
    var vp = svg.querySelector('#vp'); vp.removeAttribute('transform');
    svg.setAttribute('viewBox', '0 0 ' + L.W + ' ' + L.H); svg.setAttribute('width', L.W); svg.setAttribute('height', L.H);
    var cs = getComputedStyle(document.documentElement), vars = ['--bg', '--fg', '--muted', '--line', '--panel', '--blue', '--green', '--orange', '--purple', '--red', '--yellow', '--mono'];
    var root = ':root{' + vars.map(function(v){ return v + ':' + cs.getPropertyValue(v); }).join(';') + '}';
    var style = document.createElementNS(SVGNS, 'style'); style.textContent = root + Array.prototype.map.call(document.styleSheets[0].cssRules, function(r){ return r.cssText; }).filter(function(t){ return /^\.(box|r-|ovr|strip|port|pl|wire|ah-|dash|seq|hdl)/.test(t); }).join('\n') + ' text{font-family:Segoe UI,sans-serif}';
    svg.insertBefore(style, svg.firstChild);
    var bg = document.createElementNS(SVGNS, 'rect'); bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', cs.getPropertyValue('--bg')); svg.insertBefore(bg, style.nextSibling);
    var text = new XMLSerializer().serializeToString(svg);
    if (vs) vs.postMessage({ type: 'exportSvg', svg: text, name: M.test + '_architecture' });
  });
})();

/* ---------------------------------------------------------------- tables */
function short(id){ return id.replace(/^uvm_test_top\.?/, '') || 'uvm_test_top'; }
function lnk(ref, label){ return ref ? '<a class="lnk" data-uri="' + esc(ref.uri) + '" data-line="' + (ref.line || 0) + '">' + esc(label) + '</a>' : esc(label); }
function phasesView(){
  var m = M, types = m.types;
  var comps = m.order.map(function(id){ return m.nodes[id]; });
  var h = '<h2>Phase map — ' + esc(m.test) + '</h2><p class="sub">● implemented in the class · ○ inherited from a base class in the workspace · click to open. Functions take zero time; run_phase tasks run in parallel. Build is top-down, the other function phases are bottom-up.</p>';
  h += '<table><thead><tr><th>Phase</th><th>Kind</th>' + comps.map(function(n){ return '<th title="' + esc(n.id) + '">' + esc(short(n.id)) + '<div class="muted mono" style="text-transform:none;letter-spacing:0;font-weight:400">' + esc(n.type) + '</div></th>'; }).join('') + '<th>Purpose</th></tr></thead><tbody>';
  m.phases.forEach(function(p){
    h += '<tr><td class="mono">' + esc(p.name) + '</td><td><span class="tag ' + (p.kind === 'task' ? 'task' : 'fn') + '">' + p.kind + '</span></td>' + comps.map(function(n){
      var e = (m.phaseMap[n.type] || {})[p.name];
      return '<td class="c">' + (e ? '<span class="dot' + (e.inherited ? ' inh' : '') + '" title="' + esc(e.cls + '::' + p.name + (e.inherited ? ' (inherited)' : '')) + '" data-uri="' + esc(e.uri) + '" data-line="' + e.line + '"></span>' : '<span class="muted">·</span>') + '</td>';
    }).join('') + '<td class="muted">' + esc(p.note) + '</td></tr>';
  });
  return h + '</tbody></table>';
}
function connsView(){
  var m = M;
  var h = '<h2>TLM connections</h2><p class="sub">Resolved from connect() calls in each component’s connect_phase. Ports marked (inherited) come from the UVM base class.</p>';
  h += '<table><thead><tr><th>Initiator</th><th>Port</th><th></th><th>Target</th><th>Port</th><th>Kind</th><th>Wired in</th></tr></thead><tbody>' + (m.conns.map(function(c){
    var fp = m.nodes[c.from.node].ports.find(function(p){ return p.name === c.from.port; }) || {}, tp = m.nodes[c.to.node].ports.find(function(p){ return p.name === c.to.port; }) || {};
    return '<tr><td class="mono">' + esc(short(c.from.node)) + '</td><td class="mono">' + esc(c.from.port) + ' <span class="muted">' + esc(fp.type || '') + '</span></td><td>→</td><td class="mono">' + esc(short(c.to.node)) + '</td><td class="mono">' + esc(c.to.port) + ' <span class="muted">' + esc(tp.type || '') + '</span></td><td>' + esc(c.kind) + '</td><td>' + lnk(c.src, c.inType + '.connect_phase') + '</td></tr>';
  }).join('') || '<tr><td colspan="7" class="muted">No connect() calls found.</td></tr>') + '</tbody></table>';
  var unc = [];
  m.order.forEach(function(id){ m.nodes[id].ports.forEach(function(p){ if (!m.conns.some(function(c){ return (c.from.node === id && c.from.port === p.name) || (c.to.node === id && c.to.port === p.name); })) unc.push({ id: id, p: p }); }); });
  if (unc.length) h += '<div class="sec"><h2 class="warn">Unconnected ports</h2><p class="sub">Declared but never connect()-ed; data written to them goes nowhere.</p><table><thead><tr><th>Component</th><th>Port</th><th>Type</th></tr></thead><tbody>' + unc.map(function(u){ return '<tr><td class="mono">' + esc(short(u.id)) + '</td><td class="mono">' + esc(u.p.name) + '</td><td class="mono muted">' + esc(u.p.type) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  if (m.seqs.length) h += '<div class="sec"><h2>Sequences started by ' + esc(m.test) + '</h2><table><thead><tr><th>Sequence</th><th>Instance</th><th>Started on</th><th>In</th></tr></thead><tbody>' + m.seqs.map(function(s){ return '<tr><td class="mono">' + esc(s.type) + '</td><td class="mono">' + esc(s.inst) + '</td><td class="mono">' + esc(s.targetText) + (s.target ? '' : ' <span class="warn">(not found in topology)</span>') + '</td><td>' + lnk(s.src, s.in) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  return h;
}
function cfgView(){
  var c = M.cfg;
  var fields = []; c.sets.concat(c.gets).forEach(function(x){ if (fields.indexOf(x.field) < 0) fields.push(x.field); });
  var h = '<h2>uvm_config_db</h2><p class="sub">Every set() and the get() calls it can satisfy (same field name and type).</p><table><thead><tr><th>Field</th><th>Type</th><th>set() — scope</th><th>get() — by</th><th>Status</th></tr></thead><tbody>';
  fields.sort().forEach(function(f){
    var ss = c.sets.filter(function(x){ return x.field === f; }), gs = c.gets.filter(function(x){ return x.field === f; });
    var st = !ss.length ? '<span class="warn">no set() — get() will fail</span>' : !gs.length ? '<span class="muted">set but never read</span>' : '<span style="color:var(--green)">ok</span>';
    h += '<tr><td class="mono">' + esc(f) + '</td><td class="mono">' + esc((ss[0] || gs[0]).type) + '</td><td>' + (ss.map(function(s){ return lnk(s, s.file + ':' + (s.line + 1)) + ' <span class="mono muted">' + esc(s.cntxt + ', "' + s.inst + '"') + '</span>'; }).join('<br>') || '–') + '</td><td>' + (gs.map(function(g){ return lnk(g, g.file + ':' + (g.line + 1)) + ' <span class="mono muted">→ ' + esc(g.target) + '</span>'; }).join('<br>') || '–') + '</td><td>' + st + '</td></tr>';
  });
  return h + '</tbody></table>';
}

/* ---------------------------------------------------------------- wiring */
var sel = $('#test');
sel.innerHTML = DATA.tests.map(function(t){ return '<option' + (t === DATA.start ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
var tab = 'arch';
function showTab(t){
  tab = t;
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function(b){ b.classList.toggle('on', b.getAttribute('data-tab') === t); });
  ['arch', 'phases', 'conns', 'cfg'].forEach(function(k){ $('#v-' + k).hidden = k !== t; });
  $('#tools').style.visibility = t === 'arch' ? 'visible' : 'hidden';
  if (t === 'phases') $('#v-phases').innerHTML = phasesView();
  if (t === 'conns') $('#v-conns').innerHTML = connsView();
  if (t === 'cfg') $('#v-cfg').innerHTML = cfgView();
  if (t === 'arch') fit();
}
function load(t){ M = DATA.models[t]; render(); if (tab !== 'arch') showTab(tab); }
sel.addEventListener('change', function(){ load(sel.value); });
$('#tabs').addEventListener('click', function(e){ var b = e.target.closest('button[data-tab]'); if (b) showTab(b.getAttribute('data-tab')); });
document.addEventListener('click', function(e){ var a = e.target.closest('[data-uri]'); if (a) open({ uri: a.getAttribute('data-uri'), line: +a.getAttribute('data-line') }); });
$('#legend').innerHTML = [
  '<span><svg viewBox="0 0 26 14"><rect x="8" y="2" width="10" height="10" class="port-i"/></svg>port</span>',
  '<span><svg viewBox="0 0 26 14"><circle cx="13" cy="7" r="5" class="port-t"/></svg>export / imp</span>',
  '<span><svg viewBox="0 0 26 14"><path d="M13 1 L19 7 L13 13 L7 7 Z" class="port-a"/></svg>analysis port</span>',
  '<span><svg viewBox="0 0 26 14"><path d="M1 7 H25" class="wire seq_item"/></svg>seq_item</span>',
  '<span><svg viewBox="0 0 26 14"><path d="M1 7 H25" class="wire analysis"/></svg>analysis</span>',
  '<span><svg viewBox="0 0 26 14"><path d="M1 7 H25" class="dash"/></svg>sequence start / config_db</span>',
  '<span class="muted">drag to pan · wheel to zoom · click to open source</span>'
].join('');
load(DATA.start);
if (/^#(phases|conns|cfg)$/.test(location.hash)) showTab(location.hash.slice(1));
})();
`;

module.exports = { buildModel, show, html, portDir };

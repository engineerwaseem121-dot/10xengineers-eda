'use strict';
/* 10xEngineers EDA — Yosys JSON netlist (write_json) → interactive schematic.
 * Click a cell/port → jump to its RTL source (Yosys "src" attribute "file.v:12.3-12.20").
 * "What drives this?" highlights the transitive fan-in cone of a selected net/cell (and "What does this drive?" the fan-out).
 * Works with any Yosys flow; the extension can also run yosys for you (read → prep -top → write_json) when it is installed. */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

/* ------------------------------------------------------------------ model */
function parseSrc(src) {
  if (!src) return null;
  const first = String(src).split('|')[0];
  const m = /^(.*?):(\d+)(?:\.(\d+))?(?:-(\d+)\.(\d+))?$/.exec(first);
  return m ? { file: m[1], line: +m[2], col: m[3] ? +m[3] : 1 } : null;
}
/** build a graph for one module: nodes (ports + cells), net bits → driver node + load nodes */
function buildGraph(json, top) {
  const mods = json.modules || {};
  const names = Object.keys(mods);
  if (!names.length) throw new Error('no modules in this Yosys JSON');
  top = top || names.find(n => mods[n].attributes && (mods[n].attributes.top === 1 || mods[n].attributes.top === '00000000000000000000000000000001')) || names[0];
  const M = mods[top];
  if (!M) throw new Error(`module ${top} not found (have: ${names.join(', ')})`);
  const nodes = [], drivers = new Map(), loads = new Map();
  const addBit = (map, b, v) => { if (typeof b !== 'number') return; if (!map.has(b)) map.set(b, []); map.get(b).push(v); };
  for (const [pn, p] of Object.entries(M.ports || {})) {
    const id = 'port:' + pn;
    nodes.push({ id, kind: p.direction === 'input' ? 'in' : p.direction === 'output' ? 'out' : 'inout', name: pn, type: p.direction, width: p.bits.length, src: parseSrc((M.netnames && M.netnames[pn] && M.netnames[pn].attributes || {}).src) });
    p.bits.forEach(b => { if (p.direction === 'input') addBit(drivers, b, { node: id, port: pn }); else addBit(loads, b, { node: id, port: pn }); });
  }
  for (const [cn, c] of Object.entries(M.cells || {})) {
    const id = 'cell:' + cn;
    const dirs = c.port_directions || {};
    nodes.push({ id, kind: 'cell', name: cn, type: String(c.type).replace(/^\$/, ''), sub: !!mods[c.type], params: c.parameters || {}, src: parseSrc((c.attributes || {}).src), ports: Object.keys(c.connections || {}) });
    for (const [pn, bits] of Object.entries(c.connections || {})) {
      const dir = dirs[pn] || (/^(Y|Q|O|OUT)$/i.test(pn) ? 'output' : 'input');
      bits.forEach(b => addBit(dir === 'output' ? drivers : loads, b, { node: id, port: pn }));
    }
  }
  // nets: name → bits (prefer non-hidden names)
  const nets = [];
  for (const [nn, n] of Object.entries(M.netnames || {})) nets.push({ name: nn, bits: n.bits, hidden: !!n.hide_name || /^\$/.test(nn), src: parseSrc((n.attributes || {}).src) });
  const bitName = new Map();
  nets.slice().sort((a, b) => a.hidden - b.hidden).forEach(n => n.bits.forEach((b, i) => { if (typeof b === 'number' && !bitName.has(b)) bitName.set(b, n.bits.length > 1 ? `${n.name}[${i}]` : n.name); }));
  // edges node→node aggregated over bits
  const emap = new Map();
  for (const [b, ds] of drivers) for (const d of ds) for (const l of loads.get(b) || []) {
    const k = d.node + '>' + l.node;
    if (!emap.has(k)) emap.set(k, { from: d.node, to: l.node, bits: [], fromPort: d.port, toPort: l.port });
    emap.get(k).bits.push(b);
  }
  const edges = [...emap.values()].map(e => Object.assign(e, { label: netLabel(e.bits, nets, bitName) }));
  // readable labels: a cell with an auto-generated name is labelled by the named net it drives (e.g. "s2"), plus type and source line
  for (const n of nodes) {
    if (n.kind !== 'cell') { n.label = n.name; n.sub2 = n.type + (n.width > 1 ? ' [' + (n.width - 1) + ':0]' : ''); continue; }
    let lbl = n.name;
    if (/^\$/.test(n.name)) {
      const outBits = [...drivers].filter(([, ds]) => ds.some(d => d.node === n.id)).map(([b]) => b);
      const named = outBits.length ? netLabel(outBits, nets, bitName) : '';
      lbl = named && !/^\$/.test(named) ? named : n.type;
    }
    n.label = lbl.replace(/^\\/, '');
    n.sub2 = n.type + (n.src ? ' · L' + n.src.line : '');
  }
  return { top, modules: names, nodes, edges, nets, drivers, loads, bitName };
}
function netLabel(bits, nets, bitName) {
  const set = new Set(bits);
  const whole = nets.filter(n => !n.hidden && n.bits.length && n.bits.every(b => set.has(b)) && n.bits.length === set.size)[0];
  if (whole) return whole.name;
  const first = bitName.get(bits[0]) || '';
  if (/^\$/.test(first)) return '';                     // Yosys-internal net: no label
  return bits.length > 1 ? `${first.replace(/\[\d+\]$/, '')}{${bits.length}}` : first;
}
/** transitive fan-in (dir=-1) or fan-out (dir=+1) of a node set */
function cone(g, startIds, dir, maxDepth) {
  const adj = new Map();
  g.edges.forEach(e => { const [a, b] = dir < 0 ? [e.to, e.from] : [e.from, e.to]; if (!adj.has(a)) adj.set(a, []); adj.get(a).push({ next: b, e }); });
  const seen = new Map(startIds.map(id => [id, 0])), es = new Set();
  const q = startIds.slice();
  while (q.length) {
    const id = q.shift(); const d = seen.get(id);
    if (maxDepth && d >= maxDepth) continue;
    for (const { next, e } of adj.get(id) || []) {
      es.add(e.from + '>' + e.to);
      // stop at flip-flops after the first register boundary to keep cones readable
      if (!seen.has(next)) { seen.set(next, d + 1); const nd = g.nodes.find(n => n.id === next); if (!(nd && /dff|dlatch|sr$/i.test(nd.type) && !startIds.includes(next))) q.push(next); }
    }
  }
  return { nodes: [...seen.keys()], edges: [...es] };
}
/** start nodes for a net name: its drivers (fan-in) / loads (fan-out) */
function nodesForNet(g, name, dir) {
  const net = g.nets.find(n => n.name === name) || g.nets.find(n => n.name.endsWith('.' + name)) || g.nets.find(n => n.name.replace(/^\\/, '') === name);
  if (!net) return [];
  const map = dir < 0 ? g.drivers : g.loads;
  return [...new Set(net.bits.flatMap(b => (map.get(b) || []).map(x => x.node)))];
}
/** layered layout: column = longest path from inputs (cycles through registers broken) */
function layout(g) {
  const col = new Map();
  g.nodes.forEach(n => col.set(n.id, n.kind === 'in' ? 0 : 1));
  const isReg = id => { const n = g.nodes.find(x => x.id === id); return n && /dff|dlatch/i.test(n.type); };
  for (let it = 0; it < g.nodes.length + 2; it++) {
    let changed = false;
    for (const e of g.edges) {
      if (isReg(e.to)) continue; // registers start new paths (break loops)
      const c = col.get(e.from) + 1;
      if (c > col.get(e.to) && c < 200) { col.set(e.to, c); changed = true; }
    }
    if (!changed) break;
  }
  const maxC = Math.max(1, ...col.values());
  g.nodes.forEach(n => { if (n.kind === 'out') col.set(n.id, maxC + 1); });
  const byCol = new Map();
  g.nodes.forEach(n => { const c = col.get(n.id); if (!byCol.has(c)) byCol.set(c, []); byCol.get(c).push(n); });
  const pos = {};
  // order within a column by average predecessor row (one sweep) to reduce crossings
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  const rowOf = new Map();
  cols.forEach(c => {
    const list = byCol.get(c);
    list.forEach(n => { const preds = g.edges.filter(e => e.to === n.id && rowOf.has(e.from)).map(e => rowOf.get(e.from)); n._k = preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : 0; });
    list.sort((a, b) => a._k - b._k);
    list.forEach((n, i) => { rowOf.set(n.id, i); pos[n.id] = { x: 30 + c * 190, y: 30 + i * 70 }; });
  });
  return pos;
}

/* ------------------------------------------------------------------ yosys runner */
function runYosys(files, top, out, yosysBin) {
  const reads = files.map(f => `read_verilog -sv "${f.replace(/\\/g, '/')}"`).join('; ');
  const script = `${reads}; prep ${top ? '-top ' + top : '-auto-top'}; write_json "${out.replace(/\\/g, '/')}"`;
  return new Promise((resolve, reject) => cp.execFile(yosysBin || 'yosys', ['-q', '-p', script], { timeout: 180000, maxBuffer: 1 << 24, windowsHide: true }, (err, so, se) => {
    if (!err && fs.existsSync(out)) return resolve(out);
    // yosys not installed: use the container toolchain when it is set up and the files are mounted
    if (err && err.code === 'ENOENT' && (!yosysBin || yosysBin === 'yosys')) {
      try {
        const ct = require('./dv/container');
        if (ct.canRun(files.concat([out]))) {
          return ct.execAsync('yosys', ['-q', '-p', ct.mapText(script)], path.dirname(out), 180000).then(r => (r.code === 0 && fs.existsSync(out) ? resolve(out) : reject(new Error('yosys (container): ' + (r.err || r.out).trim().slice(0, 600)))));
        }
      } catch (e) { /* fall through to the install hint */ }
    }
    if (!err && fs.existsSync(out)) resolve(out);
    else reject(new Error(err && err.code === 'ENOENT' ? 'yosys not found. Install it (Ubuntu: sudo apt install yosys; Windows: OSS CAD Suite) or set tenxDebug.netlist.yosysPath, or open a JSON you produced with "write_json".' : String(se || (err && err.message)).trim().slice(0, 600)));
  }));
}

/* ================================================================== VS Code integration */
function register(context, deps) {
  const vscode = require('vscode');
  const sub = d => context.subscriptions.push(d);
  const panels = new Map(); // json fsPath -> {panel, g}
  let last = null;

  async function openJson(uri, focus) {
    const text = fs.readFileSync(uri.fsPath, 'utf8');
    const json = JSON.parse(text);
    if (!json.modules) throw new Error('Not a Yosys JSON netlist (no "modules").');
    let entry = panels.get(uri.fsPath);
    if (!entry) {
      const panel = vscode.window.createWebviewPanel('tenxDebug.netlist', 'Schematic: ' + path.basename(uri.fsPath), vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
      entry = { panel, uri, json };
      panels.set(uri.fsPath, entry);
      panel.onDidDispose(() => { panels.delete(uri.fsPath); if (last === entry) last = null; });
      panel.webview.html = html(panel.webview);
      panel.webview.onDidReceiveMessage(async m => {
        if (m.type === 'ready' || m.type === 'module') show(entry, m.module);
        if (m.type === 'open' && m.src) {
          const f = path.isAbsolute(m.src.file) ? m.src.file : path.join(path.dirname(uri.fsPath), m.src.file);
          const cand = [f, ...(vscode.workspace.workspaceFolders || []).map(w => path.join(w.uri.fsPath, m.src.file))].find(p => fs.existsSync(p));
          if (cand) deps.revealLine(vscode.Uri.file(cand).toString(), m.src.line - 1); else vscode.window.showWarningMessage(`Source ${m.src.file} not found next to the netlist or in the workspace.`);
        }
        if (m.type === 'cone') {
          const c = cone(entry.g, m.ids, m.dir, m.depth || 0);
          panel.webview.postMessage({ type: 'highlight', nodes: c.nodes, edges: c.edges, dir: m.dir });
        }
      });
    } else { entry.json = json; entry.panel.reveal(vscode.ViewColumn.Beside, true); show(entry); }
    last = entry;
    if (focus) setTimeout(() => focusNet(entry, focus.name, focus.dir), 400);
    return entry;
  }
  function show(entry, module) {
    entry.g = buildGraph(entry.json, module || (entry.g && entry.g.top));
    const pos = layout(entry.g);
    entry.panel.webview.postMessage({ type: 'graph', top: entry.g.top, modules: entry.g.modules, nodes: entry.g.nodes.map(n => Object.assign({}, n, pos[n.id])), edges: entry.g.edges.map(e => ({ from: e.from, to: e.to, label: e.label, w: e.bits.length })) });
  }
  function focusNet(entry, name, dir) {
    const ids = nodesForNet(entry.g, name, dir);
    if (!ids.length) { vscode.window.showWarningMessage(`'${name}' is not a net in ${entry.g.top} (optimised away, renamed, or in a sub-module — pick that module in the schematic).`); return; }
    const c = cone(entry.g, ids, dir, 0);
    entry.panel.webview.postMessage({ type: 'highlight', nodes: c.nodes, edges: c.edges, dir, focus: ids, title: `${dir < 0 ? 'Fan-in of' : 'Fan-out of'} ${name}` });
  }

  sub(vscode.commands.registerCommand('tenxDebug.netlist.open', async uri => {
    try {
      if (!(uri instanceof vscode.Uri)) {
        const p = await vscode.window.showOpenDialog({ filters: { 'Yosys JSON': ['json'] }, openLabel: 'Open schematic' });
        if (!p) return; uri = p[0];
      }
      await openJson(uri);
    } catch (e) { vscode.window.showErrorMessage('Schematic: ' + e.message); }
  }));
  sub(vscode.commands.registerCommand('tenxDebug.netlist.synthesize', async uri => {
    const ed = vscode.window.activeTextEditor;
    const file = uri instanceof vscode.Uri ? uri.fsPath : ed && ed.document.fileName;
    if (!file) return;
    const text = fs.readFileSync(file, 'utf8');
    const mods = [...text.matchAll(/^\s*module\s+(\w+)/gm)].map(m => m[1]);
    const top = mods.length > 1 ? await vscode.window.showQuickPick(mods, { placeHolder: 'Top module' }) : mods[0];
    const out = file.replace(/\.[^.]+$/, '') + '.netlist.json';
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'yosys: prep + write_json…' }, () => runYosys([file], top, out, vscode.workspace.getConfiguration('tenxDebug').get('netlist.yosysPath')));
      await openJson(vscode.Uri.file(out));
    } catch (e) { vscode.window.showErrorMessage('Schematic: ' + e.message); }
  }));
  const whatDrives = dir => async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const r = ed.selection.isEmpty ? ed.document.getWordRangeAtPosition(ed.selection.active, /[A-Za-z_]\w*/) : ed.selection;
    if (!r) return;
    const name = ed.document.getText(r).trim();
    let entry = last;
    if (!entry) {
      // look for a netlist next to the file: <base>.netlist.json, *.json with "modules"
      const dir0 = path.dirname(ed.document.fileName);
      const cands = [ed.document.fileName.replace(/\.[^.]+$/, '') + '.netlist.json'].concat(fs.readdirSync(dir0).filter(f => /\.json$/i.test(f)).map(f => path.join(dir0, f)));
      const hit = cands.find(f => { try { return fs.existsSync(f) && /"modules"\s*:/.test(fs.readFileSync(f, 'utf8').slice(0, 2000)); } catch (e) { return false; } });
      if (!hit) { const c = await vscode.window.showInformationMessage('No Yosys netlist open. Synthesize this file with yosys, or open an existing write_json output?', 'Synthesize', 'Open JSON…'); if (c === 'Synthesize') await vscode.commands.executeCommand('tenxDebug.netlist.synthesize', ed.document.uri); else if (c) await vscode.commands.executeCommand('tenxDebug.netlist.open'); if (!last) return; entry = last; }
      else entry = await openJson(vscode.Uri.file(hit));
    }
    entry.panel.reveal(vscode.ViewColumn.Beside, true);
    focusNet(entry, name, dir);
  };
  sub(vscode.commands.registerCommand('tenxDebug.netlist.whatDrives', whatDrives(-1)));
  sub(vscode.commands.registerCommand('tenxDebug.netlist.whatLoads', whatDrives(1)));

  function html(webview) {
    const n = deps.nonce();
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${deps.csp(webview, n)}">
<style>
html,body{height:100%;margin:0}body{display:flex;flex-direction:column;font-family:var(--vscode-font-family);font-size:12px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)}
.bar{display:flex;gap:6px;align-items:center;padding:5px 8px;border-bottom:1px solid var(--vscode-panel-border)}
button{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#fff);border:0;border-radius:3px;padding:3px 8px;cursor:pointer}
select,input{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:3px;padding:2px 4px}
#wrap{flex:1;overflow:hidden;position:relative}svg{width:100%;height:100%;cursor:grab}
.node rect{fill:var(--vscode-editorWidget-background,#252526);stroke:#64748b;stroke-width:1.2;rx:4}
.node.in rect{stroke:#22c55e}.node.out rect{stroke:#38bdf8}.node.reg rect{stroke:#a78bfa;stroke-width:2}.node.sub rect{stroke:#f59e0b;stroke-dasharray:4 2}
.node text{fill:var(--vscode-editor-foreground);font-family:var(--vscode-editor-font-family);font-size:11px}.node .ty{fill:var(--vscode-descriptionForeground);font-size:10px}
.node:hover rect{stroke:#facc15}.node.sel rect{stroke:#facc15;stroke-width:2.5}
.edge{fill:none;stroke:#64748b;stroke-opacity:.7}.elabel{fill:var(--vscode-descriptionForeground);font-size:9px}
.dim{opacity:.18}.hot rect{stroke:#f472b6!important;stroke-width:2.5}.edge.hot{stroke:#f472b6;stroke-opacity:1;stroke-width:2}
.muted{color:var(--vscode-descriptionForeground)}#info{padding:4px 8px;border-top:1px solid var(--vscode-panel-border);min-height:18px}
</style></head><body>
<div class="bar"><b>Schematic</b><select id="mod"></select><input id="find" placeholder="find cell / port"><button id="fanin" title="Highlight everything that drives the selection (fan-in cone)">What drives this?</button><button id="fanout" title="Highlight everything the selection drives">What does it drive?</button><button id="clear">Clear</button><button id="fit">Fit</button><span class="muted">click = select · double-click = open source · wheel = zoom · drag = pan</span></div>
<div id="wrap"><svg id="svg"><g id="vp"></g></svg></div><div id="info" class="muted"></div>
<script nonce="${n}">
const vs=acquireVsCodeApi();const $=i=>document.getElementById(i);let G=null,sel=new Set(),tx={x:0,y:0,k:1};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function apply(){$('vp').setAttribute('transform','translate('+tx.x+','+tx.y+') scale('+tx.k+')');}
function fit(){if(!G||!G.nodes.length)return;const xs=G.nodes.map(n=>n.x),ys=G.nodes.map(n=>n.y);const w=Math.max(...xs)+170,h=Math.max(...ys)+60;const W=$('wrap').clientWidth,H=$('wrap').clientHeight;tx.k=Math.min(2,Math.min(W/w,H/h));tx.x=10;tx.y=10;apply();}
function draw(){const by={};G.nodes.forEach(n=>by[n.id]=n);let h='';
G.edges.forEach((e,i)=>{const a=by[e.from],b=by[e.to];if(!a||!b)return;const x1=a.x+140,y1=a.y+20,x2=b.x,y2=b.y+20,mx=(x1+x2)/2;const back=x2<=x1;const d=back?'M'+x1+','+y1+' C'+(x1+60)+','+(y1-50)+' '+(x2-60)+','+(y2-50)+' '+x2+','+y2:'M'+x1+','+y1+' C'+mx+','+y1+' '+mx+','+y2+' '+x2+','+y2;
h+='<path class="edge" data-e="'+esc(e.from+'>'+e.to)+'" d="'+d+'" stroke-width="'+Math.min(4,1+Math.log2(e.w))+'"></path><text class="elabel" x="'+(mx-20)+'" y="'+((y1+y2)/2-3)+'">'+esc(e.label)+'</text>';});
G.nodes.forEach(n=>{const reg=/dff|dlatch/i.test(n.type);const cls='node '+(n.kind==='cell'?(reg?'reg':'')+(n.sub?' sub':''):n.kind);
h+='<g class="'+cls+'" data-id="'+esc(n.id)+'" transform="translate('+n.x+','+n.y+')"><rect width="140" height="40"></rect><text x="7" y="16">'+esc(String(n.label||n.name).slice(0,20))+'</text><text class="ty" x="7" y="31">'+esc(String(n.sub2||n.type).slice(0,24))+'</text><title>'+esc(n.name)+'</title></g>';});
$('vp').innerHTML=h;fit();}
window.addEventListener('message',e=>{const m=e.data;if(m.type==='graph'){G=m;$('mod').innerHTML=m.modules.map(x=>'<option'+(x===m.top?' selected':'')+'>'+esc(x)+'</option>').join('');sel.clear();draw();$('info').textContent=m.nodes.length+' nodes, '+m.edges.length+' connections in '+m.top;}
if(m.type==='highlight'){const ns=new Set(m.nodes),es=new Set(m.edges);document.querySelectorAll('.node').forEach(g=>{g.classList.toggle('hot',ns.has(g.dataset.id));g.classList.toggle('dim',!ns.has(g.dataset.id));});document.querySelectorAll('.edge').forEach(p=>{p.classList.toggle('hot',es.has(p.dataset.e));p.classList.toggle('dim',!es.has(p.dataset.e));});
$('info').textContent=(m.title||(m.dir<0?'Fan-in cone':'Fan-out cone'))+': '+(m.nodes.length)+' node(s) — stops one register deep'; if(m.focus){sel=new Set(m.focus);mark();}}});
function mark(){document.querySelectorAll('.node').forEach(g=>g.classList.toggle('sel',sel.has(g.dataset.id)));}
$('vp').addEventListener('click',e=>{const g=e.target.closest('.node');if(!g)return;if(!e.ctrlKey&&!e.metaKey)sel.clear();sel.add(g.dataset.id);mark();const n=G.nodes.find(x=>x.id===g.dataset.id);$('info').textContent=n.name+' · '+n.type+(n.src?' · '+n.src.file+':'+n.src.line:'')+(n.params&&Object.keys(n.params).length?' · '+Object.entries(n.params).map(([k,v])=>k+'='+(/^[01]+$/.test(v)&&v.length>8?parseInt(v,2):v)).join(' '):'');});
$('vp').addEventListener('dblclick',e=>{const g=e.target.closest('.node');if(!g)return;const n=G.nodes.find(x=>x.id===g.dataset.id);if(n.src)vs.postMessage({type:'open',src:n.src});});
$('fanin').onclick=()=>{if(sel.size)vs.postMessage({type:'cone',ids:[...sel],dir:-1});};$('fanout').onclick=()=>{if(sel.size)vs.postMessage({type:'cone',ids:[...sel],dir:1});};
$('clear').onclick=()=>{document.querySelectorAll('.dim,.hot').forEach(x=>x.classList.remove('dim','hot'));sel.clear();mark();};$('fit').onclick=fit;
$('mod').onchange=e=>vs.postMessage({type:'module',module:e.target.value});
$('find').addEventListener('keydown',e=>{if(e.key!=='Enter')return;const q=e.target.value.toLowerCase();const n=G.nodes.find(x=>x.name.toLowerCase().includes(q));if(!n)return;sel=new Set([n.id]);mark();tx.k=1.2;tx.x=-n.x*tx.k+$('wrap').clientWidth/2-80;tx.y=-n.y*tx.k+$('wrap').clientHeight/2;apply();});
let pan=null;$('svg').addEventListener('mousedown',e=>{if(e.target.closest('.node'))return;pan={x:e.clientX-tx.x,y:e.clientY-tx.y};});window.addEventListener('mousemove',e=>{if(pan){tx.x=e.clientX-pan.x;tx.y=e.clientY-pan.y;apply();}});window.addEventListener('mouseup',()=>pan=null);
$('svg').addEventListener('wheel',e=>{e.preventDefault();const r=$('svg').getBoundingClientRect();const mx=e.clientX-r.left,my=e.clientY-r.top;const k=e.deltaY>0?0.85:1.18;tx.x=mx-(mx-tx.x)*k;tx.y=my-(my-tx.y)*k;tx.k*=k;apply();},{passive:false});
vs.postMessage({type:'ready'});
</script></body></html>`;
  }
}

module.exports = { register, buildGraph, cone, nodesForNet, layout, parseSrc, runYosys };

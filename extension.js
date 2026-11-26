'use strict';
const vscode = require('vscode');
const path = require('path');
const { parseVcd } = require('./src/vcd');
const fsmLib = require('./src/fsm');
const symbols = require('./src/symbols');
const lint = require('./src/lint');
const features = require('./src/features');

const HDL_SELECTOR = [{ language: 'verilog' }, { language: 'systemverilog' }];
const HDL_GLOB = '**/*.{v,vh,vl,sv,svh,svi}';
const EXCLUDE_GLOB = '**/{node_modules,.git,out,build,obj_dir,work,.Xil}/**';

let ctx;
const isHdl = doc => doc && (doc.languageId === 'verilog' || doc.languageId === 'systemverilog');
const cfg = () => vscode.workspace.getConfiguration('tenxDebug');

function nonce() {
  let s = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function readText(uri) {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  const buf = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(buf).toString('utf8');
}

async function revealLine(uri, line) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
  const pos = new vscode.Position(Math.max(0, line || 0), 0);
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(pos, pos), preserveFocus: false });
}

/* ------------------------------------------------------------------ FSM index */
class FsmIndex {
  constructor() {
    this.map = new Map();
    this._em = new vscode.EventEmitter();
    this.onDidChange = this._em.event;
    this.fire = debounce(() => this._em.fire(), 200);
  }
  async scanAll() {
    this.map.clear();
    const files = await vscode.workspace.findFiles(HDL_GLOB, EXCLUDE_GLOB, 3000);
    await Promise.all(files.map(f => this.updateUri(f, false)));
    this._em.fire();
  }
  async updateUri(uri, fire = true) {
    try { this.setText(uri, await readText(uri), fire); } catch (e) { /* unreadable */ }
  }
  setText(uri, text, fire = true) {
    let fsms = [];
    try { fsms = fsmLib.extractFsms(text); } catch (e) { fsms = []; }
    const u = uri.toString();
    fsms.forEach(f => { f.file = u; f.key = u + '#' + f.id; });
    if (fsms.length) this.map.set(u, fsms); else this.map.delete(u);
    if (fire) this.fire();
  }
  remove(uri) { this.map.delete(uri.toString()); this.fire(); }
  all() { return [].concat(...this.map.values()); }
  payload() {
    return this.all().map(f => ({
      key: f.key, id: f.id, name: f.name, module: f.module, file: f.file, fileName: path.basename(vscode.Uri.parse(f.file).fsPath),
      line: f.line, width: f.width, reset: f.reset, stateVars: f.stateVars, states: f.states, transitions: f.transitions
    }));
  }
}

/* ------------------------------------------------------------------ Symbol index (go to definition) */
class SymbolIndex {
  constructor() { this.map = new Map(); this.ready = null; }
  ensure() {
    if (!this.ready) this.ready = (async () => {
      const files = await vscode.workspace.findFiles(HDL_GLOB, EXCLUDE_GLOB, 5000);
      await Promise.all(files.map(f => this.update(f)));
    })();
    return this.ready;
  }
  async update(uri, text) {
    try {
      if (text === undefined) text = await readText(uri);
      this.map.set(uri.toString(), symbols.flatDecls(text));
    } catch (e) { /* ignore */ }
  }
  remove(uri) { this.map.delete(uri.toString()); }
  find(name) {
    const out = [];
    this.map.forEach((decls, u) => decls.forEach(d => { if (d.name === name) out.push({ uri: u, ...d }); }));
    return out;
  }
  query(q) {
    const out = [];
    const lq = q.toLowerCase();
    this.map.forEach((decls, u) => decls.forEach(d => { if (!lq || d.name.toLowerCase().includes(lq)) out.push({ uri: u, ...d }); }));
    return out.slice(0, 500);
  }
}

const SYMBOL_KIND = {
  module: vscode.SymbolKind.Module, interface: vscode.SymbolKind.Interface, program: vscode.SymbolKind.Module,
  package: vscode.SymbolKind.Package, class: vscode.SymbolKind.Class, covergroup: vscode.SymbolKind.Struct,
  function: vscode.SymbolKind.Function, task: vscode.SymbolKind.Method, checker: vscode.SymbolKind.Module,
  enum: vscode.SymbolKind.Enum, struct: vscode.SymbolKind.Struct, typedef: vscode.SymbolKind.TypeParameter
};

/* ------------------------------------------------------------------ Waveform custom editor */
// A "<wave>.tenxview.json" next to a dump gives a shareable starting view (rows, decoders, markers, tools).
// The saved per-workspace layout wins, unless the view file has changed since it was last applied.
function initialLayout(fsPath, layoutKey) {
  const fs = require('fs'), f = fsPath + '.tenxview.json';
  let mtime = 0;
  try { mtime = fs.statSync(f).mtimeMs; } catch (e) { return ctx.workspaceState.get(layoutKey) || null; }
  const saved = ctx.workspaceState.get(layoutKey);
  if (saved && ctx.workspaceState.get(layoutKey + ':view') === mtime) return saved;
  try {
    const l = JSON.parse(fs.readFileSync(f, 'utf8'));
    ctx.workspaceState.update(layoutKey + ':view', mtime);
    return l;
  } catch (e) { return saved || null; }
}
class WaveEditorProvider {
  constructor(fsmIndex) { this.fsmIndex = fsmIndex; }

  openCustomDocument(uri) { return { uri, dispose() {} }; }

  async resolveCustomEditor(doc, panel) {
    const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = waveHtml(panel.webview);
    const layoutKey = 'layout:' + doc.uri.toString();
    let parsed = null;
    const post = m => panel.webview.postMessage(m);

    const load = async () => {
      parsed = parseVcd(await waveApi.loadText(doc.uri));
      if (ctxv) waveApi.reindex(ctxv);
    };
    const ctxv = { fsPath: doc.uri.fsPath, post, parsed: () => parsed, ready: false };

    const subs = [];
    subs.push(waveApi.attach(doc.uri.fsPath, ctxv));
    subs.push(panel.webview.onDidReceiveMessage(async m => {
      try {
        switch (m.type) {
          case 'ready':
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: '10xEngineers EDA: loading ' + path.basename(doc.uri.fsPath) }, load);
            post({ type: 'init', meta: parsed.meta, fsms: this.fsmIndex.payload(), layout: initialLayout(doc.uri.fsPath, layoutKey), fileName: path.basename(doc.uri.fsPath), settings: waveApi.settings() });
            ctxv.ready = true;
            waveApi.flush(doc.uri.fsPath);
            break;
          case 'request':
            if (!parsed) return;
            post({ type: 'data', items: m.ids.filter(id => parsed.data[id]).map(id => ({ id, t: parsed.data[id].t, v: parsed.data[id].v })) });
            break;
          case 'saveLayout':
            ctx.workspaceState.update(layoutKey, m.layout);
            break;
          case 'openSource':
            await revealLine(m.file, m.line);
            break;
          case 'reload':
            await load();
            post({ type: 'reload', meta: parsed.meta });
            break;
          case 'exportSvg':
            await saveSvg(m.svg, m.name);
            break;
          case 'info':
            vscode.window.showInformationMessage(m.text);
            break;
          default:
            await waveApi.onMessage(m, ctxv);
        }
      } catch (e) {
        post({ type: 'error', message: String(e && e.message || e) });
        vscode.window.showErrorMessage('10xEngineers EDA: ' + (e && e.message || e));
      }
    }));

    // live reload when the simulator rewrites the VCD
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(doc.uri.fsPath)), path.basename(doc.uri.fsPath)));
    const onChange = debounce(async () => {
      try { await load(); post({ type: 'reload', meta: parsed.meta }); } catch (e) { /* partially written file */ }
    }, 500);
    subs.push(watcher, watcher.onDidChange(onChange), watcher.onDidCreate(onChange));
    subs.push(this.fsmIndex.onDidChange(() => post({ type: 'fsms', fsms: this.fsmIndex.payload() })));
    panel.onDidDispose(() => { waveApi.clearInline(ctxv); subs.forEach(s => s.dispose()); });
  }
}
let waveApi = null;

function webviewUris(webview, files) {
  const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
  return files.map(f => webview.asWebviewUri(vscode.Uri.joinPath(media, f)));
}

function csp(webview, n) {
  return `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}'; font-src ${webview.cspSource};`;
}

function waveHtml(webview) {
  const n = nonce();
  const [css, fsmJs, waveJs, decJs] = webviewUris(webview, ['wave.css', 'fsmRender.js', 'wave.js', 'decoders.js']);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(webview, n)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}"><title>10xEngineers EDA</title></head>
<body>
<div id="toolbar">
  <span class="brand">10xEngineers EDA</span>
  <button id="bSidebar" title="Toggle signal browser">☰</button>
  <span class="sep"></span>
  <button id="bZoomIn" title="Zoom in (+ / Ctrl+wheel)">＋</button>
  <button id="bZoomOut" title="Zoom out (-)">－</button>
  <button id="bFit" title="Zoom to fit (F)">Fit</button>
  <button id="bZoomCur" title="Center on cursor (C)">⌖</button>
  <span class="sep"></span>
  <button id="bPrev" title="Previous edge of selected signal (←)">⇤</button>
  <button id="bNext" title="Next edge of selected signal (→)">⇥</button>
  <span class="sep"></span>
  <button id="bMarker" title="Add a named marker at the cursor (M) — Shift+click also adds one">⚑ Marker</button>
  <button id="bTools" title="Tools: markers, protocol decoders + transaction table, pattern search, switching activity, X-trace, log correlation">⚙ Tools</button>
  <button id="bFsm" title="Toggle FSM panel: live state diagram + FSM coverage">◆ FSM</button>
  <button id="bGtkw" title="Import a GTKWave .gtkw save file (signals, radix, markers)">.gtkw</button>
  <button id="bReload" title="Reload waveform from disk">⟳</button>
  <button id="bClear" title="Remove all signals">✕</button>
  <span class="grow"></span>
  <span id="readout"></span>
</div>
<div id="main">
  <div id="sidebar">
    <input id="filter" type="text" placeholder="Filter signals…  (click to add)">
    <div id="tree"></div>
    <div id="sideinfo"></div>
  </div>
  <div id="waves">
    <div id="header"><div id="hNames">Signals</div><div id="hValues">Value</div><canvas id="ruler"></canvas></div>
    <div id="scroller">
      <div id="names"></div>
      <div id="values"></div>
      <div id="wavecol"><canvas id="wave"></canvas></div>
    </div>
    <div id="tools" class="hidden">
      <div id="toolTabs"></div>
      <div id="toolBody">
        <div id="tab-markers" class="tab"></div><div id="tab-tx" class="tab hidden"></div><div id="tab-search" class="tab hidden"></div>
        <div id="tab-activity" class="tab hidden"></div><div id="tab-xtrace" class="tab hidden"></div><div id="tab-log" class="tab hidden"></div>
      </div>
    </div>
  </div>
  <div id="fsmPane" class="hidden">
    <div class="fsmHead"><select id="fsmSel"></select><button id="fsmFit" title="Fit diagram">Fit</button><button id="fsmSvg" title="Save diagram as SVG">SVG</button><button id="fsmSrc" title="Open FSM source">Src</button></div>
    <div id="fsmInfo"></div>
    <svg id="fsmSvgEl"></svg>
    <div id="fsmCov"></div>
  </div>
</div>
<div id="ctxmenu" class="hidden"></div>
<div id="toast" class="hidden"></div>
<script nonce="${n}" src="${fsmJs}"></script>
<script nonce="${n}" src="${decJs}"></script>
<script nonce="${n}" src="${waveJs}"></script>
</body></html>`;
}

async function saveSvg(svg, name) {
  const def = vscode.workspace.workspaceFolders ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, (name || 'fsm') + '.svg') : undefined;
  const uri = await vscode.window.showSaveDialog({ defaultUri: def, filters: { SVG: ['svg'] } });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(svg, 'utf8'));
  vscode.window.showInformationMessage('Saved ' + path.basename(uri.fsPath));
}

/* ------------------------------------------------------------------ FSM diagram panel (source view) */
const fsmPanels = new Map(); // uri -> {panel, fsmId}

function fsmPanelHtml(webview) {
  const n = nonce();
  const [css, fsmJs, panelJs] = webviewUris(webview, ['fsm.css', 'fsmRender.js', 'fsmPanel.js']);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(webview, n)}">
<link rel="stylesheet" href="${css}"><title>FSM</title></head>
<body>
<div id="bar">
  <select id="sel"></select>
  <button id="fit" title="Fit to view">Fit</button>
  <button id="relayout" title="Reset layout">Re-layout</button>
  <button id="svg" title="Save as SVG">Save SVG</button>
  <button id="mermaid" title="Copy Mermaid stateDiagram">Copy Mermaid</button>
  <button id="dot" title="Copy Graphviz DOT">Copy DOT</button>
  <span class="grow"></span><span id="stats"></span>
</div>
<div id="body"><svg id="diagram"></svg><div id="side"><h3>Transitions</h3><div id="tlist"></div><h3>Checks</h3><div id="issues"></div></div></div>
<script nonce="${n}" src="${fsmJs}"></script>
<script nonce="${n}" src="${panelJs}"></script>
</body></html>`;
}

async function showFsm(uriArg, fsmId) {
  let uri = uriArg instanceof vscode.Uri ? uriArg : (typeof uriArg === 'string' ? vscode.Uri.parse(uriArg) : null);
  if (!uri) {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !isHdl(ed.document)) { vscode.window.showWarningMessage('Open a Verilog/SystemVerilog file to show its FSM diagram.'); return; }
    uri = ed.document.uri;
    if (!fsmId) {
      const fsms = fsmLib.extractFsms(ed.document.getText());
      const line = ed.selection.active.line;
      const near = fsms.filter(f => f.caseLines.some(l => l <= line)).sort((a, b) => Math.max(...b.caseLines.filter(l => l <= line)) - Math.max(...a.caseLines.filter(l => l <= line)))[0];
      if (near) fsmId = near.id;
    }
  }
  const key = uri.toString();
  let entry = fsmPanels.get(key);
  if (entry) {
    if (fsmId) entry.fsmId = fsmId;
    entry.panel.reveal(vscode.ViewColumn.Beside, true);
    await pushFsm(entry, uri);
    return;
  }
  const panel = vscode.window.createWebviewPanel('tenxDebug.fsm', 'FSM: ' + path.basename(uri.fsPath), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
    enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')]
  });
  panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'activity.svg');
  panel.webview.html = fsmPanelHtml(panel.webview);
  entry = { panel, fsmId, uri };
  fsmPanels.set(key, entry);
  panel.webview.onDidReceiveMessage(async m => {
    switch (m.type) {
      case 'ready': await pushFsm(entry, uri); break;
      case 'select': entry.fsmId = m.id; await pushFsm(entry, uri); break;
      case 'openLine': await revealLine(key, m.line); break;
      case 'exportSvg': await saveSvg(m.svg, m.name); break;
      case 'copy': await vscode.env.clipboard.writeText(m.text); vscode.window.showInformationMessage(m.what + ' copied to clipboard'); break;
      case 'positions': ctx.workspaceState.update('fsmpos:' + key + '#' + m.id, m.pos); break;
    }
  });
  panel.onDidDispose(() => fsmPanels.delete(key));
}

async function pushFsm(entry, uri) {
  const text = await readText(uri);
  const fsms = fsmLib.extractFsms(text);
  let f = fsms.find(x => x.id === entry.fsmId) || fsms[0];
  if (f) entry.fsmId = f.id;
  const key = uri.toString();
  entry.panel.webview.postMessage({
    type: 'fsm',
    fileName: path.basename(uri.fsPath),
    list: fsms.map(x => ({ id: x.id, label: (x.module ? x.module + ' · ' : '') + x.name })),
    fsm: f || null,
    issues: f ? fsmLib.lintFsm(f) : [],
    mermaid: f ? fsmLib.toMermaid(f) : '',
    dot: f ? fsmLib.toDot(f) : '',
    positions: f ? ctx.workspaceState.get('fsmpos:' + key + '#' + f.id) || null : null
  });
}

/* ------------------------------------------------------------------ Tree views */
class FsmTree {
  constructor(index) {
    this.index = index;
    this._em = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._em.event;
    index.onDidChange(() => this._em.fire());
  }
  getTreeItem(e) { return e; }
  getChildren(el) {
    if (!el) {
      return [...this.index.map.keys()].sort().map(u => {
        const uri = vscode.Uri.parse(u);
        const it = new vscode.TreeItem(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.Expanded);
        it.resourceUri = uri;
        it.description = vscode.workspace.asRelativePath(path.dirname(uri.fsPath));
        it.contextValue = 'file';
        it._u = u;
        return it;
      });
    }
    if (el._u && !el._f) {
      return (this.index.map.get(el._u) || []).map(f => {
        const it = new vscode.TreeItem((f.module ? f.module + ' · ' : '') + f.name, vscode.TreeItemCollapsibleState.Collapsed);
        it.description = `${f.states.length} states · ${f.transitions.length} transitions`;
        it.iconPath = new vscode.ThemeIcon('type-hierarchy');
        it.tooltip = `Reset: ${f.reset}\nState vars: ${f.stateVars.join(', ')}`;
        it.command = { command: 'tenxDebug.showFsm', title: 'Show FSM', arguments: [vscode.Uri.parse(f.file), f.id] };
        it._u = el._u; it._f = f;
        return it;
      });
    }
    if (el._f) {
      const f = el._f;
      return f.states.map(s => {
        const it = new vscode.TreeItem(s.name, vscode.TreeItemCollapsibleState.None);
        const outs = f.transitions.filter(t => t.from === s.name && t.to !== s.name).map(t => t.to);
        it.description = (s.value != null ? '= ' + s.value : '') + (outs.length ? '  → ' + [...new Set(outs)].join(', ') : '');
        it.iconPath = new vscode.ThemeIcon(s.name === f.reset ? 'debug-start' : 'circle-outline');
        it.command = { command: 'vscode.open', title: 'Go to state', arguments: [vscode.Uri.parse(f.file), { selection: new vscode.Range(s.line, 0, s.line, 0) }] };
        return it;
      });
    }
    return [];
  }
}

class WaveTree {
  constructor() { this._em = new vscode.EventEmitter(); this.onDidChangeTreeData = this._em.event; }
  refresh() { this._em.fire(); }
  getTreeItem(e) { return e; }
  async getChildren() {
    const files = await vscode.workspace.findFiles('**/*.vcd', EXCLUDE_GLOB, 500);
    return files.sort((a, b) => a.fsPath.localeCompare(b.fsPath)).map(u => {
      const it = new vscode.TreeItem(path.basename(u.fsPath));
      it.resourceUri = u;
      it.description = vscode.workspace.asRelativePath(path.dirname(u.fsPath));
      it.iconPath = new vscode.ThemeIcon('pulse');
      it.command = { command: 'vscode.openWith', title: 'Open', arguments: [u, 'tenxDebug.waveform'] };
      return it;
    });
  }
}

/* ------------------------------------------------------------------ activate */
function activate(context) {
  ctx = context;
  const fsmIndex = new FsmIndex();
  const symIndex = new SymbolIndex();
  const fsmDiag = vscode.languages.createDiagnosticCollection('10x-fsm');
  const lintDiag = vscode.languages.createDiagnosticCollection('10x-lint');
  const waveTree = new WaveTree();
  const sub = d => context.subscriptions.push(d);

  sub(fsmDiag); sub(lintDiag);
  waveApi = require('./src/wavetools').register(context, { cfg });
  require('./src/wavedrom').register(context, { nonce, csp, revealLine });
  // Excel viewer: test plans and coverage workbooks open in a VS Code tab
  require('./src/xlsxview').register(context, { nonce, csp });
  require('./src/netlist').register(context, { nonce, csp, revealLine });
  sub(vscode.window.registerCustomEditorProvider('tenxDebug.waveform', new WaveEditorProvider(fsmIndex), {
    webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true
  }));
  sub(vscode.window.registerTreeDataProvider('tenxDebug.fsmExplorer', new FsmTree(fsmIndex)));
  sub(vscode.window.registerTreeDataProvider('tenxDebug.waveFiles', waveTree));

  // --- FSM diagnostics + live panel refresh
  const updateFsmDiag = doc => {
    if (!isHdl(doc)) return;
    if (!cfg().get('fsm.diagnostics', true)) { fsmDiag.delete(doc.uri); return; }
    const diags = [];
    try {
      for (const f of fsmLib.extractFsms(doc.getText())) {
        const issues = fsmLib.lintFsm(f).map(is => Object.assign({ code: is.code || 'FSM' }, is));
        for (const is of waveApi.filterDiagnostics(doc, issues).kept) {
          const line = Math.min(Math.max(0, is.line), doc.lineCount - 1);
          const d = new vscode.Diagnostic(doc.lineAt(line).range, is.message,
            is.severity === 'error' ? vscode.DiagnosticSeverity.Error : is.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
          d.source = '10x FSM'; d.code = is.code;
          diags.push(d);
        }
      }
    } catch (e) { /* ignore */ }
    fsmDiag.set(doc.uri, diags);
  };
  const onEdit = debounce(doc => {
    updateFsmDiag(doc);
    fsmIndex.setText(doc.uri, doc.getText());
    symIndex.update(doc.uri, doc.getText());
    const p = fsmPanels.get(doc.uri.toString());
    if (p) pushFsm(p, doc.uri);
  }, 400);
  sub(vscode.workspace.onDidOpenTextDocument(d => { if (isHdl(d)) updateFsmDiag(d); }));
  sub(vscode.workspace.onDidChangeTextDocument(e => { if (isHdl(e.document)) onEdit(e.document); }));
  sub(vscode.workspace.onDidCloseTextDocument(d => fsmDiag.delete(d.uri)));
  vscode.workspace.textDocuments.forEach(updateFsmDiag);

  const hdlWatcher = vscode.workspace.createFileSystemWatcher(HDL_GLOB);
  sub(hdlWatcher);
  sub(hdlWatcher.onDidCreate(u => { fsmIndex.updateUri(u); symIndex.update(u); }));
  sub(hdlWatcher.onDidChange(u => { fsmIndex.updateUri(u); symIndex.update(u); }));
  sub(hdlWatcher.onDidDelete(u => { fsmIndex.remove(u); symIndex.remove(u); }));
  const vcdWatcher = vscode.workspace.createFileSystemWatcher('**/*.vcd', false, true, false);
  sub(vcdWatcher);
  sub(vcdWatcher.onDidCreate(() => waveTree.refresh()));
  sub(vcdWatcher.onDidDelete(() => waveTree.refresh()));
  fsmIndex.scanAll();

  // --- linting
  const runLint = async (doc, explicit) => {
    if (!isHdl(doc) || doc.uri.scheme !== 'file') return;
    const res = await lint.lintFile(doc.uri.fsPath, cfg());
    if (res.missing && explicit) vscode.window.showWarningMessage(`10xEngineers EDA: linter '${res.tool}' not found on PATH. Set tenxDebug.lint.* in settings.`);
    if (!res.tool) {
      if (explicit) vscode.window.showWarningMessage('10xEngineers EDA: no linter found. Install Verilator or Icarus Verilog (iverilog) and make sure it is on PATH.');
      return;
    }
    const wf = waveApi.filterDiagnostics(doc, res.items);
    lintDiag.set(doc.uri, wf.kept.map(it => {
      const line = Math.min(Math.max(0, it.line), doc.lineCount - 1);
      const r = it.col ? new vscode.Range(line, it.col, line, doc.lineAt(line).range.end.character) : doc.lineAt(line).range;
      const d = new vscode.Diagnostic(r, it.message, it.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      d.source = res.tool; if (it.code) d.code = it.code;
      return d;
    }));
    if (explicit && res.skipped) vscode.window.showInformationMessage('10xEngineers EDA: lint skipped. ' + res.skipped + '.');
    else if (explicit) vscode.window.setStatusBarMessage(`10xEngineers EDA: ${res.tool} reported ${res.items.length} issue(s)${wf.waived ? `, ${wf.waived} waived` : ''}`, 4000);
  };
  sub(vscode.workspace.onDidSaveTextDocument(d => { if (cfg().get('lint.onSave', true)) runLint(d, false); }));

  // --- language features
  sub(vscode.languages.registerDocumentSymbolProvider(HDL_SELECTOR, {
    provideDocumentSymbols(doc) {
      const conv = s => {
        const end = Math.min(Math.max(s.endLine, s.line), doc.lineCount - 1);
        const range = new vscode.Range(s.line, 0, end, doc.lineAt(end).text.length);
        const sel = doc.lineAt(Math.min(s.line, doc.lineCount - 1)).range;
        const ds = new vscode.DocumentSymbol(s.name, s.detail || s.kind, SYMBOL_KIND[s.kind] || vscode.SymbolKind.Object, range, sel);
        ds.children = s.children.map(conv);
        return ds;
      };
      return symbols.documentSymbols(doc.getText()).map(conv);
    }
  }));

  sub(vscode.languages.registerDefinitionProvider(HDL_SELECTOR, {
    async provideDefinition(doc, pos) {
      const r = doc.getWordRangeAtPosition(pos, /[A-Za-z_]\w*/);
      if (!r) return;
      const word = doc.getText(r);
      // local FSM state constants first
      for (const f of fsmLib.extractFsms(doc.getText())) {
        const s = f.states.find(x => x.name === word);
        if (s) return new vscode.Location(doc.uri, new vscode.Position(s.declLine, 0));
      }
      await symIndex.ensure();
      await symIndex.update(doc.uri, doc.getText());
      return symIndex.find(word).map(d => new vscode.Location(vscode.Uri.parse(d.uri), new vscode.Position(d.line, 0)));
    }
  }));

  sub(vscode.languages.registerWorkspaceSymbolProvider({
    async provideWorkspaceSymbols(q) {
      await symIndex.ensure();
      return symIndex.query(q).map(d => new vscode.SymbolInformation(d.name, SYMBOL_KIND[d.kind] || vscode.SymbolKind.Object, d.container,
        new vscode.Location(vscode.Uri.parse(d.uri), new vscode.Position(d.line, 0))));
    }
  }));

  sub(vscode.languages.registerHoverProvider(HDL_SELECTOR, {
    provideHover(doc, pos) {
      const r = doc.getWordRangeAtPosition(pos, /[A-Za-z_]\w*/);
      if (!r) return;
      const word = doc.getText(r);
      for (const f of fsmLib.extractFsms(doc.getText())) {
        const s = f.states.find(x => x.name === word);
        const isVar = f.stateVars.includes(word);
        if (!s && !isVar) continue;
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        if (s) {
          const outs = f.transitions.filter(t => t.from === s.name);
          const ins = f.transitions.filter(t => t.to === s.name && t.from !== s.name);
          md.appendMarkdown(`**FSM state** \`${s.name}\`${s.value != null ? ` = ${s.value}` : ''} of \`${f.name}\`${s.name === f.reset ? ' *(reset)*' : ''}\n\n`);
          if (outs.length) md.appendMarkdown('**Exits:**\n' + outs.map(t => `- → \`${t.to}\`${t.cond ? ` when \`${t.cond}\`` : ''}`).join('\n') + '\n\n');
          if (ins.length) md.appendMarkdown('**Entered from:** ' + [...new Set(ins.map(t => '`' + t.from + '`'))].join(', ') + '\n\n');
        } else {
          md.appendMarkdown(`**FSM state variable** of \`${f.name}\` — ${f.states.length} states, reset \`${f.reset}\`\n\n`);
        }
        const args = encodeURIComponent(JSON.stringify([doc.uri.toString(), f.id]));
        md.appendMarkdown(`[◆ Show FSM diagram](command:tenxDebug.showFsm?${args})`);
        return new vscode.Hover(md, r);
      }
    }
  }));

  sub(vscode.languages.registerCodeLensProvider(HDL_SELECTOR, {
    provideCodeLenses(doc) {
      if (!cfg().get('fsm.codeLens', true)) return [];
      return fsmLib.extractFsms(doc.getText()).map(f => new vscode.CodeLens(new vscode.Range(f.line, 0, f.line, 0), {
        title: `◆ FSM '${f.name}' · ${f.states.length} states · ${f.transitions.length} transitions · Show diagram`,
        command: 'tenxDebug.showFsm',
        arguments: [doc.uri, f.id]
      }));
    }
  }));

  // --- commands
  sub(vscode.commands.registerCommand('tenxDebug.openWaveform', async uri => {
    if (!(uri instanceof vscode.Uri)) {
      const pick = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Waveforms': ['vcd', 'fst', 'ghw', 'lxt', 'lxt2'] }, openLabel: 'Open in 10xEngineers EDA' });
      if (!pick || !pick.length) return;
      uri = pick[0];
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, 'tenxDebug.waveform');
  }));
  sub(vscode.commands.registerCommand('tenxDebug.showFsm', (uri, id) => showFsm(uri, id)));
  sub(vscode.commands.registerCommand('tenxDebug.refreshFsms', () => fsmIndex.scanAll()));
  sub(vscode.commands.registerCommand('tenxDebug.refreshWaves', () => waveTree.refresh()));
  sub(vscode.commands.registerCommand('tenxDebug.lintFile', () => {
    const ed = vscode.window.activeTextEditor;
    if (ed) runLint(ed.document, true);
  }));
  sub(vscode.commands.registerCommand('tenxDebug.copyFsmMermaid', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !isHdl(ed.document)) return;
    const fsms = fsmLib.extractFsms(ed.document.getText());
    if (!fsms.length) { vscode.window.showWarningMessage('No FSM detected in this file.'); return; }
    let f = fsms[0];
    if (fsms.length > 1) {
      const p = await vscode.window.showQuickPick(fsms.map(x => ({ label: x.name, description: x.module, f: x })));
      if (!p) return;
      f = p.f;
    }
    await vscode.env.clipboard.writeText(fsmLib.toMermaid(f));
    vscode.window.showInformationMessage('Mermaid state diagram copied to clipboard');
  }));
  // coverage dashboard, Questa integration, UVM wizard, source lists
  features.register(context, { cfg, nonce, csp, revealLine });
  // language intelligence: formatter, hints, completion, hierarchy views, UVM lint, logs, RISC-V, UVM tools
  require('./src/lang').register(context, { cfg, nonce, csp, revealLine });
  // DV flow: DUT -> self-checking TB / UVM -> regression -> coverage -> evidence-backed test plan
  require('./src/dv/ext').register(context);
  // open-source toolchain in a container (Docker / Docker-in-WSL / Podman): Icarus, Verilator, UVM, GHDL, Yosys, sby, cocotb
  require('./src/toolchain').register(context);

  // MCP server for AI agents (VS Code ≥ 1.101 registers it automatically; other clients use the copied config)
  const mcpScript = vscode.Uri.joinPath(context.extensionUri, 'src', 'mcp-server.js').fsPath;
  const mcpEnv = { ELECTRON_RUN_AS_NODE: '1' };
  try {
    if (vscode.lm && vscode.lm.registerMcpServerDefinitionProvider && vscode.McpStdioServerDefinition) {
      sub(vscode.lm.registerMcpServerDefinitionProvider('tenxDebug.mcp', {
        provideMcpServerDefinitions: () => [new vscode.McpStdioServerDefinition('10xEngineers EDA', process.execPath, [mcpScript], mcpEnv, '0.2.0')]
      }));
    }
  } catch (e) { /* older host */ }
  sub(vscode.commands.registerCommand('tenxDebug.copyMcpConfig', async () => {
    const conf = { mcpServers: { '10xengineer-eda': { command: process.execPath, args: [mcpScript], env: mcpEnv } } };
    await vscode.env.clipboard.writeText(JSON.stringify(conf, null, 2));
    vscode.window.showInformationMessage('MCP server config copied. Paste it into .mcp.json (Claude Code), ~/.cursor/mcp.json (Cursor) or your agent\'s MCP settings.');
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };

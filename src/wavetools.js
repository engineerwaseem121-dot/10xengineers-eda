'use strict';
/* 10xEngineers EDA — waveform-side helpers that run in the extension host:
 *  - viewer settings (tenxDebug.wave.*)
 *  - GTKWave .gtkw import, cocotb / UVM / simulator log time correlation
 *  - waveform diff, FST/LXT/LXT2/GHW → VCD conversion through external converters
 *  - signal values from the cursor shown inline in Verilog/SystemVerilog/VHDL
 *  - lint waivers (own JSON format + inline comment) and quick fixes
 * Pure functions are exported for tests; VS Code is only required inside register(). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const UNIT_EXP = { s: 0, ms: -3, us: -6, ns: -9, ps: -12, fs: -15 };

/* ------------------------------------------------------------------ time helpers */
/** seconds per VCD tick */
function tickSeconds(timescale) { return timescale.mult * Math.pow(10, timescale.exp); }
function toTicks(value, unit, timescale) { return Math.round(value * Math.pow(10, UNIT_EXP[unit] != null ? UNIT_EXP[unit] : -9) / tickSeconds(timescale)); }

/* ------------------------------------------------------------------ GTKWave .gtkw */
/** parse the parts of a .gtkw save file we can map: traces (with radix flags), markers, named markers */
function parseGtkw(text, timescale) {
  const signals = [], markers = [];
  let flags = 0;
  // GTKWave TR_* flags: HEX 0x2, DEC 0x4, BIN 0x8, OCT 0x10, RJUSTIFY 0x20, SIGNED 0x400, ASCII 0x800, REAL 0x2000
  const radixOf = f => (f & 0x800 ? 'ascii' : f & 0x400 ? 'signed' : f & 0x8 ? 'bin' : f & 0x10 ? 'oct' : f & 0x4 ? 'unsigned' : f & 0x2 ? 'hex' : null);
  const labels = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = /^@([0-9a-fA-F]+)/.exec(line))) { flags = parseInt(m[1], 16); continue; }
    // "*<zoom> <primary marker> <A> <B> …"  (times in dump units, -1 = unset)
    if (/^\*/.test(line)) {
      const tok = line.slice(1).trim().split(/\s+/).map(Number);
      if (tok[1] >= 0) markers.push({ t: tok[1], name: 'primary' });
      tok.slice(2).forEach((t, i) => { if (t >= 0) markers.push({ t, name: String.fromCharCode(65 + i), letter: String.fromCharCode(65 + i) }); });
      continue;
    }
    if ((m = /^\[markername\]\s*([A-Z])\s*(.*)$/.exec(line))) { labels[m[1]] = m[2]; continue; }
    if (/^\[[^\]]+\]/.test(line) || /^-/.test(line) || /^#/.test(line)) continue;
    // a trace line: hierarchical name, optionally with [msb:lsb] and with leading alias "{...}"
    const name = line.replace(/^\{[^}]*\}\s*/, '').replace(/\s+.*$/, '');
    if (!/^[A-Za-z_\\$][\w.$\\\[\]:]*$/.test(name)) continue;
    signals.push({ path: name.replace(/\[\d+:\d+\]$/, ''), radix: radixOf(flags) || undefined });
  }
  markers.forEach(mk => { if (mk.letter && labels[mk.letter]) mk.name = labels[mk.letter]; delete mk.letter; });
  void timescale;
  return { signals, markers };
}

/* ------------------------------------------------------------------ logs → waveform time */
const LOG_RULES = [
  // cocotb: "  1234.00ns INFO     cocotb.tb   message"
  { re: /^\s*(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|ms|s)\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL|TRACE)\s+(.*)$/, f: m => ({ v: +m[1], u: m[2], level: m[3], text: m[4] }) },
  // UVM: "UVM_ERROR tb.sv(52) @ 1200: uvm_test_top.env [SCB] ..." (optionally with unit)
  { re: /(UVM_(?:INFO|WARNING|ERROR|FATAL))\b.*?@\s*(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|ms|s)?\s*:\s*(.*)$/, f: (m, du) => ({ v: +m[2], u: m[3] || du, level: m[1].replace('UVM_', ''), text: m[4] }) },
  // Questa: "# Time: 120 ns  Iteration: 0  Instance: /tb"
  { re: /Time:\s*(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|ms|s)\b(.*)$/, f: m => ({ v: +m[1], u: m[2], level: 'INFO', text: 'Time ' + m[1] + ' ' + m[2] + m[3] }) },
  // DVFLOW / $display style: "... @66000ns ..." or "at time 120 ns"
  { re: /(?:@|at time\s*)\s*(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|ms|s)\b/, f: (m, du, line) => ({ v: +m[1], u: m[2], level: /(ERROR|FAIL|MISMATCH|MISSING|TIMEOUT|FATAL)/i.test(line) ? 'ERROR' : /WARN/i.test(line) ? 'WARNING' : 'INFO', text: line.trim() }) }
];
function parseLog(text, timescale, defaultUnit) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const r of LOG_RULES) {
      const m = r.re.exec(line);
      if (!m) continue;
      const e = r.f(m, defaultUnit || 'ns', line);
      if (!isFinite(e.v)) continue;
      out.push({ t: toTicks(e.v, e.u, timescale), level: e.level, text: e.text.slice(0, 400), line: i });
      break;
    }
  });
  return out;
}

/* ------------------------------------------------------------------ waveform diff */
function valueAt(d, t) {
  const a = d.t;
  if (!a.length || a[0] > t) return null;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= t) lo = m; else hi = m - 1; }
  return d.v[lo];
}
function listVars(meta) {
  const out = [];
  const walk = (sc, prefix) => { sc.vars.forEach(v => out.push(Object.assign({}, v, { scope: prefix }))); sc.scopes.forEach(s => walk(s, prefix ? prefix + '.' + s.name : s.name)); };
  walk(meta.tree, '');
  return out;
}
/** compare two parsed dumps; returns [{path, firstDiff (A ticks), a, b, count}] sorted by first divergence, plus onlyA/onlyB */
function diffWaves(A, B, opts) {
  opts = opts || {};
  const va = listVars(A.meta), vb = listVars(B.meta);
  const strip = p => p.split('.').slice(1).join('.');
  const mapB = new Map(vb.map(v => [v.path, v]));
  const mapBs = new Map(vb.map(v => [strip(v.path), v]));
  const scale = tickSeconds(B.meta.timescale) / tickSeconds(A.meta.timescale);   // B ticks → A ticks
  const out = [], onlyA = [];
  const matched = new Set();
  for (const a of va) {
    const b = mapB.get(a.path) || mapBs.get(strip(a.path));
    if (!b) { onlyA.push(a.path); continue; }
    matched.add(b.path);
    const da = A.data[a.id], db = B.data[b.id];
    if (!da || !db) continue;
    const times = [...new Set(da.t.concat(db.t.map(t => Math.round(t * scale))))].sort((x, y) => x - y);
    let first = null, count = 0, fa = null, fb = null;
    const norm = s => (s == null ? null : s.replace(/^0+(?=[01])/, ''));
    for (const t of times) {
      if (opts.from != null && t < opts.from) continue;
      const x = valueAt(da, t), y = valueAt(db, t / scale);
      if (norm(x) !== norm(y)) { count++; if (first == null) { first = t; fa = x; fb = y; } }
    }
    if (first != null) out.push({ path: a.path, firstDiff: first, a: fa, b: fb, count });
  }
  const onlyB = vb.filter(v => !matched.has(v.path)).map(v => v.path);
  out.sort((x, y) => x.firstDiff - y.firstDiff);
  return { diffs: out, onlyA, onlyB, compared: va.length - onlyA.length };
}

/* ------------------------------------------------------------------ converters for non-VCD formats */
const DEFAULT_CONVERTERS = {
  fst: 'fst2vcd -f "{in}" -o "{out}"',
  lxt2: 'lxt2vcd "{in}" -o "{out}"',
  lxt: 'lxt2vcd "{in}" -o "{out}"',
  vzt: 'vzt2vcd "{in}" -o "{out}"',
  ghw: ''
};
function converterFor(ext, user) {
  const e = ext.replace(/^\./, '').toLowerCase();
  const u = user && user[e];
  return u != null ? u : DEFAULT_CONVERTERS[e];
}
/** convert to a temp VCD; resolves the VCD path or rejects with an actionable message */
function convertToVcd(file, userConverters) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const tpl = converterFor(ext, userConverters);
  if (!tpl) {
    return Promise.reject(new Error(ext === 'ghw'
      ? 'GHW files need a converter. Either re-run GHDL with --vcd=waves.vcd (or --fst=waves.fst), or set "tenxDebug.wave.converters": {"ghw": "<your tool> \\"{in}\\" \\"{out}\\""}.'
      : `No converter configured for .${ext}. Set tenxDebug.wave.converters.${ext}.`));
  }
  const out = path.join(os.tmpdir(), 'tenx-wave-' + path.basename(file).replace(/[^\w.-]/g, '_') + '-' + Date.now() + '.vcd');
  const cmd = tpl.replace(/\{in\}/g, file).replace(/\{out\}/g, out);
  return new Promise((resolve, reject) => {
    cp.exec(cmd, { timeout: 120000, maxBuffer: 1 << 24, windowsHide: true }, (err, so, se) => {
      if (!err && fs.existsSync(out)) return resolve(out);
      const tool = tpl.split(/\s+/)[0];
      const notFound = /not recognized|not found|ENOENT|No such file/i.test(String(se) + String(err && err.message));
      reject(new Error(notFound
        ? `'${tool}' was not found. It ships with GTKWave (Windows: install GTKWave and add its bin folder to PATH; Ubuntu: sudo apt install gtkwave). Or set tenxDebug.wave.converters.${ext}.`
        : `Converting ${path.basename(file)} with "${cmd}" failed: ${(String(se) || String(err && err.message)).trim().slice(0, 400)}`));
    });
  });
}

/* ------------------------------------------------------------------ inline RTL values */
const V_DECL = /^\s*(?:input|output|inout|wire|reg|logic|bit|integer|int|var|tri|uwire)\b(.*)$/;
const VHDL_DECL = /^\s*(?:signal\s+|variable\s+)?([A-Za-z]\w*(?:\s*,\s*[A-Za-z]\w*)*)\s*:\s*(?:in|out|inout|buffer)?\s*[A-Za-z]/i;
/** declared identifiers per line: [{line, names:[{name, col}]}] */
function declaredNames(text, isVhdl) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let module = null;
  lines.forEach((ln, i) => {
    let code = ln.replace(/\/\/.*$|--.*$/, '');
    let m;
    if ((m = /^\s*(?:module|entity|interface)\s+(\w+)/i.exec(code))) module = m[1];
    // ANSI header on the module line: "module m #(...) (input logic a, ..."
    if (!isVhdl) { const pre = /^\s*module\s+\w+\s*(?:#\s*\(.*?\)\s*)?\(/.exec(code); if (pre) code = ' '.repeat(pre[0].length) + code.slice(pre[0].length); }
    if (isVhdl) {
      if ((m = VHDL_DECL.exec(code)) && !/^\s*(?:port|generic|constant|type|subtype|function|procedure|component|attribute|alias|file)\b/i.test(code)) {
        const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
        out.push({ line: i, module, names: names.map(n => ({ name: n, col: code.indexOf(n) })) });
      }
      return;
    }
    if ((m = V_DECL.exec(code))) {
      let rest = m[1].replace(/\[[^\]]*\]/g, ' ').replace(/\b(?:signed|unsigned|wire|reg|logic|bit|var)\b/g, ' ').replace(/=[^,;]*/g, '');
      const names = (rest.match(/[A-Za-z_]\w*/g) || []).filter(n => !/^(input|output|inout|parameter|localparam|integer|int)$/.test(n));
      if (names.length) out.push({ line: i, module, names: names.map(n => ({ name: n, col: code.indexOf(n) })) });
    }
  });
  return out;
}
function fmtValue(raw, width) {
  if (raw == null) return null;
  if (raw[0] === 'r') return raw.slice(1);
  if (raw[0] === 's') return '"' + raw.slice(1) + '"';
  if (width <= 1 || raw.length === 1) return raw;
  if (/[^01]/.test(raw)) return /^x+$/.test(raw) ? `${width}'hx` : /^z+$/.test(raw) ? `${width}'hz` : `${width}'b${raw}`;
  return `${width}'h${BigInt('0b' + raw).toString(16)}`;
}

/* ------------------------------------------------------------------ lint waivers */
/* File format (.tenx-waivers.json at the workspace root, path configurable):
 * { "version": 1,
 *   "waivers": [ { "rule": "WIDTHTRUNC", "file": "rtl/alu.sv", "match": "assign y = a + b;", "line": 41,
 *                  "reason": "intentional truncation", "owner": "waseem", "expires": "2027-06-30" } ] }
 * - rule: diagnostic code (or "*"); file: workspace-relative path or glob with *; match: optional text that must appear on the line
 *   (robust to line moves); line: optional exact 1-based line used only when match is absent; expires: optional ISO date.
 * Inline form, on the flagged line or the line above:   // tenx-lint-waive RULE: reason   (VHDL: -- tenx-lint-waive RULE: reason)
 */
function globToRe(g) { return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$', 'i'); }
function isWaived(waivers, diag, relFile, lineText, prevLineText, today) {
  const code = String(diag.code || '').trim();
  const inline = /(?:tenx-lint-waive|10x-waive)\s+([\w*-]+)/i;
  for (const t of [lineText, prevLineText]) {
    const m = t && inline.exec(t);
    if (m && (m[1] === '*' || m[1].toLowerCase() === code.toLowerCase())) return { inline: true, reason: (t.split(/(?:tenx-lint-waive|10x-waive)\s+[\w*-]+\s*:?/i)[1] || '').trim() };
  }
  const rf = relFile.replace(/\\/g, '/');
  for (const w of waivers || []) {
    if (w.expires && today && w.expires < today) continue;
    if (w.rule && w.rule !== '*' && w.rule.toLowerCase() !== code.toLowerCase()) continue;
    if (w.file && !globToRe(w.file.replace(/\\/g, '/')).test(rf)) continue;
    if (w.match) { if (!lineText || !lineText.includes(w.match)) continue; }
    else if (w.line && w.line !== diag.line + 1) continue;
    if (w.message && !String(diag.message).includes(w.message)) continue;
    return w;
  }
  return null;
}

/* ================================================================== VS Code integration */
function register(context, deps) {
  const vscode = require('vscode');
  const { cfg } = deps;
  const sub = d => context.subscriptions.push(d);
  const W = () => vscode.workspace.getConfiguration('tenxDebug.wave');

  const api = {};
  api.settings = () => {
    const c = W();
    return {
      display: { defaultTraceStyle: c.get('display.defaultTraceStyle'), disableGpu: c.get('display.disableGpu') },
      keyboard: { addSignal: c.get('keyboard.addSignal'), reload: c.get('keyboard.reload'), zoomAmount: c.get('keyboard.zoomAmount'), zoomStart: c.get('keyboard.zoomStart'), zoomEnd: c.get('keyboard.zoomEnd'), zoomFit: c.get('keyboard.zoomFit'), zoomIn: c.get('keyboard.zoomIn'), zoomOut: c.get('keyboard.zoomOut'), zoomTarget: c.get('keyboard.zoomTarget') },
      mouse: { reverseScrolling: c.get('mouse.reverseScrolling'), zoomAmount: c.get('mouse.zoomAmount'), zoomTarget: c.get('mouse.zoomTarget') },
      theme: { palette: c.get('theme.palette'), minContrast: c.get('theme.minContrast') }
    };
  };

  /* --- open viewers registry (for diff jump, settings push, inline values) */
  const viewers = new Map();     // fsPath -> {post, parsed(), pending:[msgs]}
  api.attach = (fsPath, v) => { viewers.set(fsPath.toLowerCase(), v); return { dispose: () => viewers.delete(fsPath.toLowerCase()) }; };
  api.queue = (fsPath, msg) => {
    const v = viewers.get(fsPath.toLowerCase());
    if (v && v.ready) v.post(msg); else { const q = api.pending.get(fsPath.toLowerCase()) || []; q.push(msg); api.pending.set(fsPath.toLowerCase(), q); }
  };
  api.pending = new Map();
  api.flush = fsPath => { const q = api.pending.get(fsPath.toLowerCase()); api.pending.delete(fsPath.toLowerCase()); const v = viewers.get(fsPath.toLowerCase()); if (q && v) q.forEach(m => v.post(m)); };
  sub(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('tenxDebug.wave')) viewers.forEach(v => v.ready && v.post({ type: 'settings', settings: api.settings() }));
  }));

  /* --- load any supported dump as text VCD */
  api.loadText = async uri => {
    const ext = path.extname(uri.fsPath).toLowerCase();
    const maxMB = Number(W().get('maxFileMB')) || 256;
    if (uri.scheme === 'file' && (ext === '.vcd' || ext === '.evcd')) {
      const size = fs.statSync(uri.fsPath).size;
      if (size > maxMB * 1048576) throw new Error(`${path.basename(uri.fsPath)} is ${(size / 1048576).toFixed(0)} MiB, above the ${maxMB} MiB limit (tenxDebug.wave.maxFileMB). Dump a smaller window ($dumpon/$dumpoff, or a narrower $dumpvars scope), or use FST.`);
      // read in 4 MiB chunks rather than one large allocation
      return await new Promise((resolve, reject) => {
        const parts = [];
        fs.createReadStream(uri.fsPath, { highWaterMark: 4 * 1048576 }).on('data', b => parts.push(b.toString('latin1'))).on('error', reject).on('end', () => resolve(parts.join('')));
      });
    }
    if (ext === '.vcd' || ext === '.evcd' || uri.scheme !== 'file') {
      const buf = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(buf).toString('latin1');
    }
    const out = await convertToVcd(uri.fsPath, W().get('converters') || {});
    try { return fs.readFileSync(out, 'latin1'); } finally { try { fs.unlinkSync(out); } catch (e) { /* temp */ } }
  };

  /* --- webview message hooks */
  api.onMessage = async (m, ctxv) => {
    switch (m.type) {
      case 'importGtkw': {
        const pick = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'GTKWave save file': ['gtkw', 'sav'] }, defaultUri: vscode.Uri.file(path.dirname(ctxv.fsPath)) });
        if (!pick || !pick.length) return true;
        const g = parseGtkw(fs.readFileSync(pick[0].fsPath, 'utf8'), ctxv.parsed().meta.timescale);
        ctxv.post({ type: 'addSignals', signals: g.signals, markers: g.markers, source: path.basename(pick[0].fsPath) });
        return true;
      }
      case 'loadLog': {
        const pick = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Logs: ['log', 'txt', 'out', 'transcript'], All: ['*'] }, defaultUri: vscode.Uri.file(path.dirname(ctxv.fsPath)) });
        if (!pick || !pick.length) return true;
        ctxv.logFile = pick[0];
        const entries = parseLog(fs.readFileSync(pick[0].fsPath, 'utf8'), ctxv.parsed().meta.timescale, W().get('logTimeUnit') || 'ns');
        if (!entries.length) vscode.window.showWarningMessage('No timestamped lines found (expected cocotb "123.00ns INFO …", UVM "@ 120:", "Time: 120 ns" or "@120ns").');
        ctxv.post({ type: 'log', entries });
        return true;
      }
      case 'openLogLine':
        if (ctxv.logFile) { const doc = await vscode.workspace.openTextDocument(ctxv.logFile); await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, selection: new vscode.Range(m.line, 0, m.line, 0) }); }
        return true;
      case 'cursor':
        inline.update(ctxv, m.t, m.time);
        return true;
      case 'xtraceRtl': {
        const rtlx = require('./rtlx');
        const index = await rtlIndex(ctxv.fsPath);
        if (!Object.keys(index).length) { ctxv.post({ type: 'xtraceRtl', error: 'No Verilog/SystemVerilog modules found in the workspace (or next to the waveform).' }); return true; }
        const res = rtlx.traceX(ctxv.parsed(), listVars(ctxv.parsed().meta), index, { path: m.path, t: m.t });
        const rel = f => (f ? vscode.workspace.asRelativePath(f) : null);
        if (res.steps) res.steps.forEach(s => { s.fileRel = rel(s.file); if (s.driver) { s.driverLine = s.driver.line; s.driverText = s.driver.text; s.driverFile = s.driver.file || s.file; } delete s.driver; delete s.drivers; });
        if (res.root) { res.root.fileRel = rel(res.root.file); if (res.root.driver) { res.root.driverLine = res.root.driver.line; res.root.driverText = res.root.driver.text; res.root.driverFile = res.root.driver.file || res.root.file; } delete res.root.driver; delete res.root.drivers; }
        ctxv.post(Object.assign({ type: 'xtraceRtl', modules: Object.keys(index).length }, res));
        return true;
      }
      case 'openFileLine': {
        if (!m.file) return true;
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(m.file));
        const ln = Math.max(0, Math.min(doc.lineCount - 1, m.line || 0));
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: !!m.preserveFocus, selection: new vscode.Range(ln, 0, ln, doc.lineAt(ln).text.length) });
        return true;
      }
      case 'selected':
        // cross-probe: follow the waveform selection into the RTL only when the user opted in
        if (!W().get('crossProbe.followWaveformSelection', false)) {
          if (!api.toldFollow) { api.toldFollow = true; out().appendLine('Selecting a signal does not move the editor (tenxDebug.wave.crossProbe.followWaveformSelection is off). Right-click a signal → "Go to declaration in RTL", or turn the setting on.'); }
          return true;
        }
        await revealDecl(m.path, true);
        return true;
      case 'revealDecl':
        await revealDecl(m.path, false);
        return true;
    }
    return false;
  };
  const out = () => (api.chan = api.chan || vscode.window.createOutputChannel('10xEngineer Waveform'));

  /* --- RTL index for X-trace and cross-probe (workspace HDL + files next to the dump), cached for 5 s */
  let rtlCache = null;
  async function rtlIndex(fsPath) {
    if (rtlCache && Date.now() - rtlCache.at < 5000 && rtlCache.near === path.dirname(fsPath)) return rtlCache.index;
    const rtlx = require('./rtlx');
    const uris = await vscode.workspace.findFiles('**/*.{v,sv,vh,svh}', '**/{node_modules,.git,obj_dir,work,build,out}/**', 3000);
    const files = new Set(uris.map(u => u.fsPath));
    try { for (const f of fs.readdirSync(path.dirname(fsPath))) if (/\.(s?v|s?vh)$/i.test(f)) files.add(path.join(path.dirname(fsPath), f)); } catch (e) { /* none */ }
    const list = [];
    for (const f of files) {
      const open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === f);
      try { list.push({ file: f, text: open ? open.getText() : fs.readFileSync(f, 'utf8') }); } catch (e) { /* unreadable */ }
    }
    rtlCache = { at: Date.now(), near: path.dirname(fsPath), index: rtlx.buildIndex(list) };
    return rtlCache.index;
  }
  async function revealDecl(p, preserveFocus) {
    const rtlx = require('./rtlx');
    const anyViewer = [...viewers.values()][0];
    const index = await rtlIndex(anyViewer ? anyViewer.fsPath : (vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath + '/x' : process.cwd() + '/x'));
    const clean = p.replace(/\s*\[[^\]]*\]$/, '');
    const scope = clean.split('.').slice(0, -1).join('.'), leaf = clean.split('.').pop();
    const hit = rtlx.findDeclaration(index, scope, leaf);
    const show = async h => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(h.file));
      const ln = Math.min(h.line, doc.lineCount - 1);
      const col = Math.max(0, doc.lineAt(ln).text.indexOf(leaf));
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus, selection: new vscode.Range(ln, col, ln, col + leaf.length) });
    };
    if (!hit) { vscode.window.setStatusBarMessage(`No declaration of ${leaf} found in the workspace RTL`, 4000); return; }
    if (hit.ambiguous) {
      // never guess: let the user choose
      if (preserveFocus) { vscode.window.setStatusBarMessage(`${leaf} is declared in ${hit.ambiguous.length} modules — ambiguous, not followed (use Go to declaration)`, 5000); return; }
      const pick = await vscode.window.showQuickPick(hit.ambiguous.map(h => ({ label: h.module, description: `${vscode.workspace.asRelativePath(h.file)}:${h.line + 1}`, h })), { placeHolder: `${leaf} is declared in several modules and scope ${scope} could not be matched — pick one` });
      if (pick) await show(pick.h);
      return;
    }
    await show(hit);
  }

  /* --- inline values from the waveform cursor */
  const deco = vscode.window.createTextEditorDecorationType({ after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'italic', margin: '0 0 0 2em' } });
  sub(deco);
  const inline = {
    src: null, t: null, time: '',
    update(ctxv, t, time) { this.src = ctxv; this.t = t; this.time = time; this.index = null; this.paint(); },
    buildIndex() {
      const p = this.src.parsed();
      const by = new Map();
      for (const v of listVars(p.meta)) {
        const leaf = v.name.replace(/\s*\[.*$/, '').toLowerCase();
        if (!by.has(leaf)) by.set(leaf, []);
        by.get(leaf).push(v);
      }
      this.index = by;
    },
    paint() {
      const on = W().get('inlineValues', true);
      for (const ed of vscode.window.visibleTextEditors) {
        const lang = ed.document.languageId;
        if (!/^(verilog|systemverilog|vhdl)$/.test(lang)) continue;
        if (!on || !this.src || this.t == null) { ed.setDecorations(deco, []); continue; }
        if (!this.index) this.buildIndex();
        const p = this.src.parsed();
        const opts = [];
        for (const dl of declaredNames(ed.document.getText(), lang === 'vhdl')) {
          const parts = [];
          for (const n of dl.names) {
            const cands = this.index.get(n.name.toLowerCase());
            if (!cands) continue;
            const best = (dl.module && cands.find(v => v.scope.split('.').some(s => s.toLowerCase() === dl.module.toLowerCase() || s.toLowerCase().startsWith('u_' + dl.module.toLowerCase()) || s.toLowerCase() === 'dut'))) || cands[0];
            const d = p.data[best.id];
            const val = d ? fmtValue(valueAt(d, this.t), best.width) : null;
            if (val != null) parts.push(`${n.name}=${val}${cands.length > 1 ? '*' : ''}`);
          }
          if (!parts.length) continue;
          const lineLen = ed.document.lineAt(dl.line).text.length;
          opts.push({ range: new vscode.Range(dl.line, lineLen, dl.line, lineLen), renderOptions: { after: { contentText: '⟵ ' + parts.join('  ') + '  @' + this.time } }, hoverMessage: new vscode.MarkdownString(`Value at the waveform cursor (${this.time}) in **${path.basename(this.src.fsPath)}**. \`*\` = name exists in several scopes; the instance matching this module (or the first) is shown.`) });
        }
        ed.setDecorations(deco, opts);
      }
    }
  };
  sub(vscode.window.onDidChangeVisibleTextEditors(() => inline.paint()));
  sub(vscode.commands.registerCommand('tenxDebug.wave.toggleInlineValues', async () => {
    const on = !W().get('inlineValues', true);
    await W().update('inlineValues', on, vscode.ConfigurationTarget.Global);
    inline.paint();
    vscode.window.setStatusBarMessage(`Inline waveform values ${on ? 'on' : 'off'}`, 3000);
  }));
  api.clearInline = ctxv => { if (inline.src === ctxv) { inline.src = null; inline.paint(); } };
  api.reindex = ctxv => { if (inline.src === ctxv) { inline.index = null; inline.paint(); } };

  /* --- some editors (VS Code forks) open .vcd as text despite the default priority: offer once to make the viewer the default */
  const askDefault = async ed => {
    if (!ed || !/\.vcd$/i.test(ed.document.uri.fsPath) || ed.document.uri.scheme !== 'file') return;
    if (context.globalState.get('tenxDebug.vcdDefaultAsked')) return;
    const assoc = vscode.workspace.getConfiguration('workbench').get('editorAssociations') || {};
    const has = Array.isArray(assoc) ? assoc.some(a => /\*\.vcd$/i.test(a.filenamePattern || '')) : Object.keys(assoc).some(k => /\*\.vcd$/i.test(k));
    if (has) return;   // an existing association is left alone
    await context.globalState.update('tenxDebug.vcdDefaultAsked', true);
    const c = await vscode.window.showInformationMessage('This .vcd opened as plain text. Open .vcd files in the 10xEngineers EDA waveform viewer by default?', 'Yes', 'No');
    if (c !== 'Yes') return;
    const cur = Array.isArray(assoc) ? {} : Object.assign({}, assoc);
    cur['*.vcd'] = 'tenxDebug.waveform';
    await vscode.workspace.getConfiguration('workbench').update('editorAssociations', cur, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.commands.executeCommand('vscode.openWith', ed.document.uri, 'tenxDebug.waveform');
  };
  sub(vscode.window.onDidChangeActiveTextEditor(ed => { askDefault(ed).catch(() => {}); }));

  /* --- waveform diff */
  sub(vscode.commands.registerCommand('tenxDebug.wave.diff', async (uriA, uriB) => {
    const pickOne = async label => {
      const r = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: label, filters: { Waveforms: ['vcd', 'fst', 'lxt', 'lxt2', 'ghw'] } });
      return r && r[0];
    };
    const A = uriA instanceof vscode.Uri ? uriA : await pickOne('Reference waveform (A)');
    if (!A) return;
    const B = uriB instanceof vscode.Uri && uriB.fsPath !== A.fsPath ? uriB : await pickOne('Waveform to compare (B)');
    if (!B) return;
    const { parseVcd } = require('./vcd');
    const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Comparing waveforms…' }, async () => {
      const pa = parseVcd(await api.loadText(A)), pb = parseVcd(await api.loadText(B));
      return { pa, r: diffWaves(pa, pb) };
    });
    const { pa, r } = res;
    const ts = pa.meta.timescale;
    const fmtT = t => { const s = t * tickSeconds(ts); for (const [u, e] of [['s', 0], ['ms', -3], ['us', -6], ['ns', -9], ['ps', -12], ['fs', -15]]) if (Math.abs(s) >= Math.pow(10, e) || u === 'fs') return (+(s / Math.pow(10, e)).toFixed(3)) + ' ' + u; return String(t); };
    const out = vscode.window.createOutputChannel ? (api.diffOut = api.diffOut || vscode.window.createOutputChannel('10xEngineer Wave Diff')) : null;
    if (out) {
      out.clear();
      out.appendLine(`A: ${A.fsPath}\nB: ${B.fsPath}\ncompared ${r.compared} signals · ${r.diffs.length} differ · only in A: ${r.onlyA.length} · only in B: ${r.onlyB.length}\n`);
      r.diffs.forEach(d => out.appendLine(`${fmtT(d.firstDiff).padStart(14)}  ${d.path}   A=${d.a}  B=${d.b}   (${d.count} differing change point(s))`));
      if (r.onlyA.length) out.appendLine('\nOnly in A: ' + r.onlyA.slice(0, 200).join(', '));
      if (r.onlyB.length) out.appendLine('Only in B: ' + r.onlyB.slice(0, 200).join(', '));
    }
    if (!r.diffs.length) { vscode.window.showInformationMessage(`Waveforms match on all ${r.compared} common signals.`); return; }
    const pick = await vscode.window.showQuickPick(r.diffs.slice(0, 500).map(d => ({ label: d.path, description: `first difference @ ${fmtT(d.firstDiff)}`, detail: `A=${d.a}  B=${d.b}  · ${d.count} differing points`, d })), { placeHolder: `${r.diffs.length} signal(s) differ — earliest first. Pick one to open A at that time (both runs side by side).` });
    if (!pick) { if (out) out.show(true); return; }
    const t = pick.d.firstDiff;
    const span = Math.max(20, (pa.meta.endTime - pa.meta.startTime) / 20);
    const early = r.diffs.filter(d => d.firstDiff <= t + span / 4).slice(0, 12).map(d => ({ path: d.path }));
    for (const [u, col] of [[A, vscode.ViewColumn.One], [B, vscode.ViewColumn.Two]]) {
      api.queue(u.fsPath, { type: 'addSignals', signals: [{ path: pick.d.path, color: '#f472b6' }].concat(early), source: 'diff' });
      api.queue(u.fsPath, { type: 'goto', t: u === A ? t : Math.round(t), span, marker: 'diff ' + pick.d.path.split('.').pop() });
      await vscode.commands.executeCommand('vscode.openWith', u, 'tenxDebug.waveform', col);
      api.flush(u.fsPath);
    }
  }));

  /* --- lint waivers */
  const waiverFile = () => {
    const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    return ws ? path.join(ws.uri.fsPath, cfg().get('lint.waiversFile') || '.tenx-waivers.json') : null;
  };
  const loadWaivers = () => { const f = waiverFile(); try { const j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); return Array.isArray(j.waivers) ? j.waivers : []; } catch (e) { return []; } };
  api.filterDiagnostics = (doc, items) => {
    const ws = vscode.workspace.getWorkspaceFolder(doc.uri);
    const rel = ws ? path.relative(ws.uri.fsPath, doc.uri.fsPath) : path.basename(doc.uri.fsPath);
    const waivers = loadWaivers();
    const today = new Date().toISOString().slice(0, 10);
    let waived = 0;
    const kept = items.filter(it => {
      const ln = Math.min(Math.max(0, it.line), doc.lineCount - 1);
      const w = isWaived(waivers, it, rel, doc.lineAt(ln).text, ln > 0 ? doc.lineAt(ln - 1).text : '', today);
      if (w) waived++;
      return !w;
    });
    return { kept, waived };
  };
  sub(vscode.languages.registerCodeActionsProvider([{ language: 'verilog' }, { language: 'systemverilog' }, { language: 'vhdl' }], {
    provideCodeActions(doc, range, cctx) {
      const acts = [];
      for (const d of cctx.diagnostics) {
        if (!d.source || /10x FSM|verilator|iverilog|slang|10x|ghdl|UVM/i.test(d.source) === false) continue;
        const rule = typeof d.code === 'object' && d.code ? String(d.code.value) : String(d.code || '*');
        const a1 = new vscode.CodeAction(`Waive '${rule}' here (record in waivers file)…`, vscode.CodeActionKind.QuickFix);
        a1.command = { command: 'tenxDebug.lint.waive', title: 'Waive', arguments: [doc.uri, d.range.start.line, rule, d.message, 'line'] };
        a1.diagnostics = [d];
        const a2 = new vscode.CodeAction(`Waive '${rule}' in this whole file…`, vscode.CodeActionKind.QuickFix);
        a2.command = { command: 'tenxDebug.lint.waive', title: 'Waive', arguments: [doc.uri, d.range.start.line, rule, d.message, 'file'] };
        a2.diagnostics = [d];
        const a3 = new vscode.CodeAction(`Add inline waiver comment for '${rule}'`, vscode.CodeActionKind.QuickFix);
        const ln = d.range.start.line;
        const indent = /^\s*/.exec(doc.lineAt(ln).text)[0];
        a3.edit = new vscode.WorkspaceEdit();
        a3.edit.insert(doc.uri, new vscode.Position(ln, 0), `${indent}${doc.languageId === 'vhdl' ? '--' : '//'} tenx-lint-waive ${rule}: <reason>\n`);
        a3.diagnostics = [d];
        acts.push(a1, a2, a3);
      }
      return acts;
    }
  }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
  sub(vscode.commands.registerCommand('tenxDebug.lint.waive', async (uri, line, rule, message, scope) => {
    if (!(uri instanceof vscode.Uri)) {
      // run from the Command Palette: waive a lint finding on the cursor's line (pick one when there are several)
      const ed = vscode.window.activeTextEditor;
      if (!ed) { vscode.window.showInformationMessage('Open an RTL file and put the cursor on a lint finding, then run "Lint: Waive Finding" (or use the light-bulb quick fix).'); return; }
      const cl = ed.selection.active.line;
      const ours = d => d.source && /10x FSM|verilator|iverilog|slang|10x|ghdl|UVM/i.test(d.source);
      let ds = vscode.languages.getDiagnostics(ed.document.uri).filter(ours);
      const here = ds.filter(d => d.range.start.line <= cl && d.range.end.line >= cl);
      if (here.length) ds = here;
      if (!ds.length) { vscode.window.showInformationMessage(`No lint finding in ${path.basename(ed.document.fileName)} to waive. Run "Lint Current File" first.`); return; }
      const pick = ds.length === 1 ? { d: ds[0] } : await vscode.window.showQuickPick(ds.map(d => ({ label: `line ${d.range.start.line + 1}: ${d.message.slice(0, 80)}`, description: String(typeof d.code === 'object' && d.code ? d.code.value : d.code || ''), d })), { placeHolder: 'Lint finding to waive' });
      if (!pick) return;
      uri = ed.document.uri; line = pick.d.range.start.line; message = pick.d.message; scope = scope || 'line';
      rule = typeof pick.d.code === 'object' && pick.d.code ? String(pick.d.code.value) : String(pick.d.code || '*');
    }
    const f = waiverFile();
    if (!f) { vscode.window.showWarningMessage('Open a workspace folder to store waivers.'); return; }
    const reason = await vscode.window.showInputBox({ prompt: `Reason for waiving ${rule}`, placeHolder: 'e.g. intentional truncation, reviewed with the designer', validateInput: v => v.trim().length < 4 ? 'Give a short reason (it is kept for reviews)' : null });
    if (!reason) return;
    const expires = await vscode.window.showInputBox({ prompt: 'Expiry date (YYYY-MM-DD, empty = never)', validateInput: v => !v || /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'YYYY-MM-DD' });
    if (expires === undefined) return;
    const doc = await vscode.workspace.openTextDocument(uri);
    const ws = vscode.workspace.getWorkspaceFolder(uri);
    const rel = (ws ? path.relative(ws.uri.fsPath, uri.fsPath) : uri.fsPath).replace(/\\/g, '/');
    let j = { version: 1, waivers: [] };
    try { j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); if (!Array.isArray(j.waivers)) j.waivers = []; } catch (e) { /* new */ }
    const w = { rule, file: rel, reason: reason.trim(), owner: os.userInfo().username, created: new Date().toISOString().slice(0, 10) };
    if (scope === 'line') { w.match = doc.lineAt(line).text.trim().slice(0, 120); w.line = line + 1; }
    if (expires) w.expires = expires;
    w.message = String(message || '').slice(0, 80);
    if (scope === 'file') delete w.message;
    j.waivers.push(w);
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n', 'utf8');
    vscode.window.showInformationMessage(`Waived ${rule} (${scope === 'line' ? 'this line' : 'whole file'}) — recorded in ${path.basename(f)}. Re-lint to refresh.`, 'Open waivers').then(c => { if (c) vscode.window.showTextDocument(vscode.Uri.file(f)); });
    vscode.commands.executeCommand('tenxDebug.lintFile');
  }));
  sub(vscode.commands.registerCommand('tenxDebug.lint.openWaivers', async () => {
    const f = waiverFile(); if (!f) return;
    if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ version: 1, waivers: [] }, null, 2) + '\n', 'utf8');
    vscode.window.showTextDocument(vscode.Uri.file(f));
  }));

  return api;
}

module.exports = { register, parseGtkw, parseLog, diffWaves, declaredNames, fmtValue, isWaived, convertToVcd, converterFor, toTicks, listVars, valueAt };

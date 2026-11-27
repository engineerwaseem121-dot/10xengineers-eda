'use strict';
/* VS Code / Cursor front-end for the DV flow engine (same engine as the dvflow CLI / Makefile). */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const runner = require('./runner');
const sim = require('./sim');
const tbgen = require('./tbgen');
const { TEMPLATES, guess } = require('./templates');
const hdl = require('../hdlparse');

function register(context) {
  const sub = d => context.subscriptions.push(d);
  const out = vscode.window.createOutputChannel('10xEngineers EDA DV');
  sub(out);
  const diag = vscode.languages.createDiagnosticCollection('dvflow');
  sub(diag);
  const cfgv = () => vscode.workspace.getConfiguration('tenxDebug');
  const engineSrc = path.join(context.extensionUri.fsPath, 'src');
  const settings = () => ({ icarusBin: cfgv().get('dv.icarusBin') || undefined, questaBin: cfgv().get('questa.path') || undefined, vcsBin: cfgv().get('dv.vcsBin') || undefined });

  /* ---------------------------------------------------------------- preview provider */
  const previews = new Map();
  const PREVIEW = 'dvflow-preview';
  const em = new vscode.EventEmitter();
  sub(vscode.workspace.registerTextDocumentContentProvider(PREVIEW, { onDidChange: em.event, provideTextDocumentContent: u => previews.get(u.path) || '' }));

  /* ---------------------------------------------------------------- project discovery */
  async function pickProject(required = true) {
    const found = (await vscode.workspace.findFiles('**/dvflow.json', '**/{node_modules,.git,runs,.dvflow}/**', 100)).map(u => path.dirname(u.fsPath));
    const ed = vscode.window.activeTextEditor;
    if (ed) { const hit = found.find(d => ed.document.uri.fsPath.startsWith(d + path.sep)); if (hit) return hit; }
    if (found.length === 1) return found[0];
    if (!found.length) { if (required) noProject(); return null; }
    const p = await vscode.window.showQuickPick(found.map(d => ({ label: path.basename(d), description: vscode.workspace.asRelativePath(d), d })), { placeHolder: 'DV project' });
    return p && p.d;
  }
  /** no DV project in the open folder: say why and offer the way forward instead of a dead end */
  async function noProject() {
    const demo = context.globalState.get('tenxDebug.demo.last') || path.join(require('os').homedir(), '10xEDA-demo');
    const hasDemo = fs.existsSync(path.join(demo, 'dvflow.json'));
    const ed = vscode.window.activeTextEditor;
    const hdl = ed && /\.(sv|v|svh|vh|vhd|vhdl)$/i.test(ed.document.fileName);
    const why = !vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders.length
      ? 'No folder is open in VS Code.'
      : 'The open folder has no DV project yet (no dvflow.json).';
    const acts = [...(hdl ? ['Select DUT in this file'] : []), hasDemo ? 'Open the demo project' : 'Create Demo Project', 'Open Folder…'];
    const a = await vscode.window.showWarningMessage(`${why} Open your RTL file and run "DV: Select DUT"${hasDemo ? `, or open the demo project (${demo})` : ', or try the ready-made demo'}.`, ...acts);
    if (a === 'Select DUT in this file') selectDut(ed.document.uri);
    else if (a === 'Create Demo Project') createDemo();
    else if (a === 'Open the demo project') {
      await context.globalState.update('tenxDebug.demo.openTourFor', path.resolve(demo));
      vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(demo), { forceNewWindow: false });
    } else if (a === 'Open Folder…') vscode.commands.executeCommand('workbench.action.files.openFolder');
  }
  /** show a DV error; typographic quotes in the DUT get a one-click fix */
  function fail(prefix, e) {
    if (e && e.code === 'SMART_QUOTES') {
      out.appendLine(e.message);
      vscode.window.showErrorMessage(`${prefix}: the design contains typographic quotes (’ “ ” –) pasted from a document. See the output for the lines.`, 'Fix quotes', 'Show lines').then(a => {
        if (a === 'Fix quotes') fixQuotes(e.files);
        if (a === 'Show lines') out.show(true);
      });
      return;
    }
    vscode.window.showErrorMessage(`${prefix}: ${e && e.message || e}`);
  }
  async function fixQuotes(files) {
    const tbg = require('./tbgen');
    if (!files || !files.length) {
      const root = await pickProject(); if (!root) return;
      try { files = runner.loadConfig(root).dut.files.map(f => path.resolve(root, f)); } catch (e) { vscode.window.showErrorMessage(e.message); return; }
    }
    let n = 0;
    const edit = new vscode.WorkspaceEdit();
    for (const f of files) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(f));
      const text = doc.getText(), fixed = tbg.fixSmartChars(text);
      if (fixed === text) continue;
      n += tbg.smartChars(text).length || 1;
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), fixed);
    }
    if (!n) { vscode.window.showInformationMessage('No typographic quotes found in the DUT files.'); return; }
    await vscode.workspace.applyEdit(edit);   // undoable with Ctrl+Z
    for (const f of files) { const d = vscode.workspace.textDocuments.find(x => x.uri.fsPath === f); if (d && d.isDirty) await d.save(); }
    vscode.window.showInformationMessage(`Replaced ${n} typographic character(s) with plain ' " - in ${files.length} file(s). Run again.`, 'Run Regression').then(a => { if (a) runRegression(); });
  }
  function trusted() {
    if (vscode.workspace.isTrusted === false) { vscode.window.showErrorMessage('Simulations run only in a trusted workspace (Workspaces: Manage Workspace Trust).'); return false; }
    return true;
  }
  function validateSettings() {
    for (const k of ['dv.icarusBin', 'dv.vcsBin']) {
      const v = cfgv().get(k);
      if (v && (!path.isAbsolute(v) || !fs.existsSync(v))) { vscode.window.showErrorMessage(`Setting tenxDebug.${k} must be an absolute, existing folder: ${v}`); return false; }
    }
    return true;
  }

  /* ---------------------------------------------------------------- 1. Select DUT */
  async function selectDut(uri) {
    let file = uri instanceof vscode.Uri ? uri.fsPath : null;
    const ed = vscode.window.activeTextEditor;
    if (!file && ed && /\.s?v$/i.test(ed.document.fileName)) file = ed.document.fileName;
    if (!file) { const f = await vscode.window.showOpenDialog({ filters: { 'Verilog/SystemVerilog': ['sv', 'v'] }, openLabel: 'Select DUT' }); if (!f) return; file = f[0].fsPath; }
    const mods = hdl.parseModules(fs.readFileSync(file, 'utf8'));
    if (!mods.length) { vscode.window.showErrorMessage('No module found in ' + path.basename(file)); return; }
    const mod = mods.length === 1 ? mods[0] : (await vscode.window.showQuickPick(mods.map(m => ({ label: m.name, description: `${m.ports.length} ports`, m })), { placeHolder: 'Top module (DUT)' }) || {}).m;
    if (!mod) return;
    // project folder: parent of design/ (or rtl/, src/, hdl/) when the file lives there, else the file's folder
    let root = path.dirname(file);
    if (/^(design|rtl|src|hdl)$/i.test(path.basename(root))) root = path.dirname(root);
    const pr = await vscode.window.showInputBox({ prompt: 'DV project folder (dvflow.json, testbench, runs/ go here)', value: root, ignoreFocusOut: true });
    if (!pr) return;
    root = pr;
    const deps = await vscode.window.showOpenDialog({ canSelectMany: true, defaultUri: vscode.Uri.file(path.dirname(file)), filters: { 'HDL': ['sv', 'v', 'svh', 'vh'] }, openLabel: 'Add source dependencies (Cancel = none)' }) || [];
    const inc = await vscode.window.showInputBox({ prompt: 'Include directories (comma separated, relative to the project; empty = none)', value: '', ignoreFocusOut: true });
    if (inc === undefined) return;
    const pdef = mod.params.map(p => `${p.name}=${p.value}`).join(', ');
    const pov = mod.params.length ? await vscode.window.showInputBox({ prompt: `Parameter overrides (defaults: ${pdef})`, value: pdef, ignoreFocusOut: true }) : '';
    if (pov === undefined) return;
    const params = {};
    (pov || '').split(',').map(s => s.trim()).filter(Boolean).forEach(s => { const [k, v] = s.split('=').map(x => x.trim()); if (k && v !== undefined && !isNaN(Number(v))) params[k] = Number(v); });
    const ident = require('./identify').identify(mod, fs.readFileSync(file, 'utf8'));
    const g = guess(mod, fs.readFileSync(file, 'utf8'));
    out.appendLine(`[identify] ${mod.name}: ${ident.label} (${ident.confidence} confidence) — ${ident.reasons.join('; ')}${ident.alternatives.length ? ' · also possible: ' + ident.alternatives.map(a => a.label).join(', ') : ''}`);
    const tp = await vscode.window.showQuickPick(Object.entries(TEMPLATES).map(([k, t]) => ({ label: t.label, description: k === g ? `suggested: ${ident.label}${ident.reasons[0] ? ' (' + ident.reasons[0] + ')' : ''}` : (k === 'custom' && !TEMPLATES[ident.template] && ident.template !== 'custom' ? `identified as ${ident.label}: write its expected behaviour` : ''), k })).sort((a, b) => (b.k === g) - (a.k === g)), { placeHolder: 'Verification template (what the DUT is meant to do)', ignoreFocusOut: true });
    if (!tp) return;
    const c = hdl.classify(mod.ports);
    const behavior = {};
    // ask only what changes the checks
    if (tp.k === 'counter' || tp.k === 'updown_counter') {
      const np = mod.params.find(p => /^(N|MAX|LIMIT|TERMINAL|MAX_COUNT|MOD)$/i.test(p.name));
      const nv = await vscode.window.showInputBox({ prompt: 'Terminal count N (counts 0..N inclusive). Use $PARAM to follow a parameter.', value: np ? '$' + np.name : '9', ignoreFocusOut: true });
      if (nv === undefined) return;
      behavior.N = /^\$/.test(nv) ? nv : Number(nv);
      const mode = await vscode.window.showQuickPick([{ label: 'wrap', description: 'N -> 0' }, { label: 'saturate', description: 'stay at N' }], { placeHolder: 'Behaviour at the terminal count' });
      if (!mode) return;
      behavior.mode = mode.label;
    }
    if (tp.k === 'pipeline') { const l = await vscode.window.showInputBox({ prompt: 'Latency in cycles (input beat -> output beat)', value: '1' }); if (l === undefined) return; behavior.latency = Number(l) || 1; }
    if (tp.k === 'latch' || tp.k === 'dff') behavior.kind = tp.k === 'latch' ? 'latch' : 'dff';
    if (tp.k === 'custom') {
      const spec = await vscode.window.showInputBox({ prompt: 'Short behaviour spec (you will add the reference model in dvflow.json → behavior)', ignoreFocusOut: true });
      behavior.spec = spec || '';
      behavior.sequential = !!c.clk;
      behavior.checks = Object.fromEntries(mod.ports.filter(p => p.dir === 'output').map(p => [p.name, `/* expected ${p.name} from in_* and m_* */ '0`]));
      behavior.model_decl = '';
      behavior.model_reset = '';
      behavior.model_step = '    // update model state m_* from in_* here';
    }
    const seq = !!c.clk && tp.k !== 'adder' && tp.k !== 'latch';
    const cfg = {
      name: mod.name, template: tp.k, mode: 'lightweight',
      // the DUT file first, then dependencies — without duplicates (picking the DUT file as a dependency used to list it twice)
      dut: { top: mod.name, files: [...new Set([path.relative(root, file), ...deps.map(d => path.relative(root, d.fsPath))].map(x => x.replace(/\\/g, '/')))], incdirs: inc ? inc.split(',').map(s => s.trim()).filter(Boolean) : [], params },
      behavior,
      clock: { name: c.clk ? c.clk.name : 'clk', edge: 'posedge', period_ns: 10 },
      reset: seq && c.rst ? { name: c.rst.name, active_low: c.activeLow, sync: false, cycles: 2 } : { name: '' },
      ports: {},
      options: Object.assign({}, tbgen.DEFAULTS.options, { assertions: false }),
      tests: tp.k === 'adder' ? ['smoke', 'boundary', 'exhaustive', 'random'] : (seq ? ['smoke', 'boundary', 'reset', 'random'] : ['smoke', 'boundary', 'random']),
      seeds: [1, 2, 3],
      configs: [{ name: 'default', params: {} }],
      simulator: cfgv().get('dv.simulator', 'icarus')
    };
    cfg.suites = { smoke: ['smoke'], full: cfg.tests };
    // dry-run the model so the proposal shows what was detected (and fails early when ports cannot be mapped)
    let detected = '';
    try {
      const d = tbgen.resolveDut(tbgen.withDefaults(cfg), root, {}, f => fs.readFileSync(f, 'utf8'));
      const m = tbgen.buildModel(tbgen.withDefaults(cfg), d.ports, d.paramValues);
      cfg.ports = m.roles || {};
      // tests = the tests the template has scenarios for (a test without scenarios would run no checks and fail)
        { const ts = [...new Set(m.scenarios.map(s => s.test).filter(Boolean))]; if (ts.length) { cfg.tests = ts; cfg.suites = { smoke: ts.includes('smoke') ? ['smoke'] : [ts[0]], full: ts }; } }
      detected = `${m.scenarios.length} scenarios, ${m.bins.length} coverage bins, checks: ${(m.checkers || []).map(x => x.id).join(', ')}`;
    } catch (e) { detected = 'needs attention: ' + e.message; }
    const target = path.join(root, 'dvflow.json');
    const text = JSON.stringify(cfg, null, 2) + '\n';
    if (fs.existsSync(target)) {
      previews.set('/dvflow.json', text);
      await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(target), vscode.Uri.parse(`${PREVIEW}:/dvflow.json`), 'dvflow.json: current ↔ proposed');
      const a = await vscode.window.showInformationMessage('Replace the existing dvflow.json with the proposed DUT configuration?', { modal: true }, 'Replace');
      if (a !== 'Replace') return;
    }
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(target, text);
    await vscode.window.showTextDocument(vscode.Uri.file(target));
    // RTL loose in the project folder: offer the standard layout (design/ next to tb/, uvm/, testplan/)
    const loose = cfg.dut.files.filter(f => !/[\\/]/.test(f));
    const acts = (tp.k === 'custom' && !behavior.sequential ? ['Write Expected Behaviour'] : ['Generate Testbench']).concat(loose.length ? ['Move RTL to design/'] : []);
    vscode.window.showInformationMessage(`Proposed DUT configuration for ${mod.name} (${detected}). Review clock edge, reset polarity/cycles, latency, enable and "behavior" (the expected results), then run "DV: Generate Testbench".${loose.length ? ' Tip: keep the RTL in design/ (next to tb/, uvm/ and testplan/).' : ''}`, ...acts).then(async x => {
      if (x === 'Move RTL to design/') { await moveRtlToDesign(root, target, loose); if (tp.k === 'custom') vscode.commands.executeCommand('tenxDebug.dv.writeBehaviour'); else generate(); }
      else if (x === 'Write Expected Behaviour') vscode.commands.executeCommand('tenxDebug.dv.writeBehaviour');
      else if (x) generate();
    });
  }

  /** move RTL files from the project folder to design/ (open editors follow) and update dvflow.json */
  async function moveRtlToDesign(root, cfgFile, names) {
    const we = new vscode.WorkspaceEdit();
    for (const n of names) {
      if (fs.existsSync(path.join(root, 'design', n))) { vscode.window.showWarningMessage(`design/${n} already exists; ${n} was not moved.`); continue; }
      we.renameFile(vscode.Uri.file(path.join(root, n)), vscode.Uri.file(path.join(root, 'design', n)), { overwrite: false });
    }
    if (!(await vscode.workspace.applyEdit(we))) { vscode.window.showErrorMessage('Could not move the RTL to design/.'); return; }
    const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    c.dut.files = c.dut.files.map(f => (names.includes(f) && fs.existsSync(path.join(root, 'design', f)) ? 'design/' + f : f));
    fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2) + '\n');
    out.appendLine(`[layout] moved ${names.join(', ')} to design/ and updated dvflow.json`);
  }

  /* ---------------------------------------------------------------- 2/3. Generate testbench / test plan (with preview) */
  async function generate(onlyPlan) {
    const root = await pickProject();
    if (!root) return;
    let cfg;
    try { cfg = runner.loadConfig(root); } catch (e) { vscode.window.showErrorMessage(e.message); return; }
    let mode = cfg.mode || 'lightweight';
    if (!onlyPlan) {
      const m = await vscode.window.showQuickPick([
        { label: 'Lightweight self-checking SV', description: 'directed + boundary + seeded random, runs on Icarus / Questa / VCS', v: 'lightweight' },
        { label: 'UVM', description: 'agent, scoreboard with the same reference model, scenario sequences (Questa / VCS)', v: 'uvm' },
        { label: 'Both', description: 'lightweight TB and UVM side by side, same scenario IDs', v: 'both' },
        { label: 'cocotb (Python)', description: 'Python reference model + cocotb tests, same scenario IDs (Icarus / Verilator; runs in the Docker toolchain)', v: 'cocotb' },
        { label: 'All: SV + UVM + cocotb', description: 'every testbench, same scenarios and requirements', v: 'all' }
      ], { placeHolder: 'Testbench mode' });
      if (!m) return;
      mode = m.v;
    }
    let plan;
    try { plan = runner.plannedFiles(root, cfg, { mode, engineSrc, runtime: process.execPath }); } catch (e) { fail('Generation failed', e); return; }
    let files = plan.files.filter(f => f.changed && (!onlyPlan || f.path === 'testplan/testplan.yaml'));
    if (!files.length) {
      // plan unchanged: still make sure the Excel copy exists
      let made = null;
      if (!fs.existsSync(require('./layout').planXlsx(root))) { try { made = require('./planxlsx').writePlan(root); } catch (e) { out.appendLine('[generate] testplan.xlsx not written: ' + e.message); } }
      vscode.window.showInformationMessage(made ? `Everything is up to date. Created the Excel test plan: ${path.basename(made)}` : 'Everything is up to date.', ...(made ? ['View in VS Code', 'Open in Excel'] : [])).then(x => { if (x === 'View in VS Code') vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(made), 'tenxDebug.xlsxViewer'); else if (x) vscode.env.openExternal(vscode.Uri.file(made)); });
      return;
    }
    const replacing = files.filter(f => f.exists && !f.engine);
    if (replacing.length) {
      // preview each replaced file as a diff, let the user choose
      const picks = await vscode.window.showQuickPick(files.map(f => ({ label: (f.exists ? '$(diff) ' : '$(new-file) ') + f.path, description: f.exists ? 'modified — select to keep checked, click to preview' : 'new', picked: true, f })), { canPickMany: true, placeHolder: `${files.length} file(s) will be written — uncheck files to keep; preview opens for modified files` , onDidSelectItem: async it => { if (it.f.exists) { previews.set('/' + it.f.path, it.f.content); em.fire(vscode.Uri.parse(`${PREVIEW}:/${it.f.path}`)); await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(it.f.abs), vscode.Uri.parse(`${PREVIEW}:/${it.f.path}`), `${it.f.path}: current ↔ generated`, { preview: true, preserveFocus: true }); } } });
      if (!picks) return;
      files = picks.map(p => p.f);
    }
    runner.writeFiles(files);
    out.appendLine(`[generate] ${files.length} file(s) written in ${root}: ${files.map(f => f.path).filter(p => !p.startsWith('.dvflow')).join(', ')}`);
    if (files.xlsx) out.appendLine(`[generate] Excel test plan: ${files.xlsx}`);
    if (files.xlsxError) out.appendLine(`[generate] testplan.xlsx not written: ${files.xlsxError}`);
    if (files.movedPlan) out.appendLine('[layout] the test plan is now in testplan/ (testplan.yaml + testplan.xlsx)');
    if (files.retiredUvm && files.retiredUvm.length) out.appendLine(`[layout] UVM files are now in uvm/tb, agent, sequences, env, tests, scripts; the old flat copies (${files.retiredUvm.length}) are in uvm/_old_flat_layout/`);
    vscode.window.showInformationMessage(`${onlyPlan ? 'Test plan' : 'Testbench'} generated (${files.length} file(s))${files.xlsx ? ' + ' + path.basename(files.xlsx) : ''}.`, 'Open test plan', ...(files.xlsx ? ['View Excel plan', 'Open in Excel'] : []), 'Run Regression').then(x => {
      if (x === 'View Excel plan') vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(files.xlsx), 'tenxDebug.xlsxViewer');
      if (x === 'Open test plan') vscode.window.showTextDocument(vscode.Uri.file(require('./layout').planYaml(root)));
      if (x === 'Open in Excel') vscode.env.openExternal(vscode.Uri.file(files.xlsx));
      if (x === 'Run Regression') runRegression();
    });
  }

  /* ---------------------------------------------------------------- 4/5. Run test / regression */
  async function execute(root, opts, title) {
    if (!trusted() || !validateSettings()) return null;
    out.show(true);
    out.appendLine('');
    let res;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (prog, token) => {
      try {
        res = await runner.regress(root, Object.assign({ log: s => { out.appendLine(s); if (/^\[(PASS|FAIL|ERROR|TIMEOUT|INCOMPLETE)/.test(s)) prog.report({ message: s.replace(/\s+\(.*$/, '') }); }, token, settings: settings(), timeoutS: cfgv().get('dv.timeoutSeconds', 300) }, opts));
      } catch (e) { out.appendLine('dvflow: ' + e.message); fail('DV run failed', e); }
    });
    if (!res) return null;
    // compile errors -> editor diagnostics
    diag.clear();
    const byFile = new Map();
    res.builds.forEach(b => (b.errors || []).filter(e => e.file && e.line).forEach(e => {
      const f = path.isAbsolute(e.file) ? e.file : path.resolve(root, e.file);
      const d = new vscode.Diagnostic(new vscode.Range(Math.max(0, e.line - 1), 0, Math.max(0, e.line - 1), 200), e.message, e.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
      d.source = 'dvflow ' + res.meta.simulator;
      (byFile.get(f) || byFile.set(f, []).get(f)).push(d);
    }));
    byFile.forEach((ds, f) => diag.set(vscode.Uri.file(f), ds));
    const t = res.totals;
    const msg = `${res.meta.dut}: ${t.pass}/${t.runs} passed · functional coverage ${res.coverage.functional.pct == null ? 'n/a' : res.coverage.functional.pct + '%'}${t.fail + t.timeout ? ` · ${t.fail + t.timeout} failing` : ''}${t.error + t.blocked + t.incomplete ? ` · ${t.error + t.blocked + t.incomplete} error/blocked/incomplete` : ''}`;
    const P = res.paths || {};
    out.appendLine(`Run folder:       ${P.run}`);
    out.appendLine(`Dashboard:        ${P.report}`);
    out.appendLine(`Test plan (YAML): ${P.testplanYaml}`);
    if (P.testplanXlsx) out.appendLine(`Test plan (Excel, updated with pass/fail and why): ${P.testplanXlsx}`);
    if (P.failures) out.appendLine(`Failure folders:  ${P.failures}`);
    const acts = ['Open Dashboard', 'Open Test Plan (Excel)', 'Reveal Run Folder'].concat(res.runs.some(r => r.failureDir) ? ['Open Failure Artifacts'] : []);
    (t.pass === t.runs ? vscode.window.showInformationMessage : vscode.window.showWarningMessage)(`${msg} — results in ${vscode.workspace.asRelativePath(P.run || root)}`, ...acts).then(x => {
      if (x === 'Open Dashboard') openDashboard(root, res.meta.runId);
      if (x === 'Open Failure Artifacts') openFailure(root, res);
      if (x === 'Open Test Plan (Excel)' && P.testplanXlsx) vscode.env.openExternal(vscode.Uri.file(P.testplanXlsx));
      if (x === 'Reveal Run Folder' && P.run) vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.join(P.run, 'results.json')));
    });
    return res;
  }

  /** Simulator pick filtered by testbench kind; shows installed / not found for each tool. */
  async function pickSimulator(kind, defaultId) {
    const ids = kind === 'uvm' ? ['questa', 'vcs', 'verilator'] : ['icarus', 'questa', 'vcs', 'verilator'];
    const caps = sim.capabilities(settings()).filter(c => ids.includes(c.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    const note = c => kind === 'uvm' && c.id === 'verilator' ? (/container/.test(c.source) ? ' · Docker toolchain, UVM included · no license needed' : ' · needs Verilator ≥ 5.054 + UVM_HOME (or the Docker toolchain)') : kind === 'uvm' && c.id === 'vcs' ? ' · unvalidated' : '';
    const pick = await vscode.window.showQuickPick(caps.map(c => ({
      label: `${c.available ? '$(check)' : '$(circle-slash)'} ${c.label}`,
      description: (c.available ? c.version : 'not found — ' + c.reason) + note(c) + (c.id === defaultId ? ' · default' : ''),
      id: c.id, available: c.available
    })), { placeHolder: kind === 'uvm' ? 'Run the UVM testbench with which simulator?' : 'Run the simple testbench with which simulator?', ignoreFocusOut: true });
    if (!pick) return null;
    if (!pick.available) {
      const a = await vscode.window.showErrorMessage(`${pick.label.replace(/^\$\([^)]*\)\s*/, '')} is not installed or not found on this machine.`, 'Configure Simulators');
      if (a) vscode.commands.executeCommand('tenxDebug.dv.configureSimulators');
      return null;
    }
    return pick.id;
  }

  /** Coverage choice for simulators with a code-coverage engine; returns 0/1, or null when cancelled. */
  async function pickCoverage(simId, uvm) {
    const c = sim.capabilities(settings()).find(x => x.id === simId);
    // simulators without a code-coverage engine: functional coverage (testbench bins) is all there is
    if (!c || !/^yes/.test(String(c.caps.code_coverage || ''))) return 'functional';
    const fun = uvm ? 'covergroups (UCDB)' : 'testbench bins';
    const code = 'statement / branch / condition / expression / toggle / FSM of the DUT';
    const p = await vscode.window.showQuickPick([
      { label: '$(graph) Functional + code coverage', description: `${fun} + ${code}`, v: 'both' },
      { label: '$(symbol-event) Functional coverage only', description: `${fun}${uvm ? '' : ' (fastest)'}`, v: 'functional' },
      { label: '$(code) Code coverage only', description: code, v: 'code' }
    ], { placeHolder: 'Coverage to collect and show in the dashboard', ignoreFocusOut: true });
    return p ? p.v : null;
  }

  /**
   * Seeds prompt shared by Run Test / Run Regression / UVM / cocotb: one seed, a list, a range (0:100), a stepped range
   * (0:100:10), "random N", or a mix. Validates while typing and shows how many runs it means.
   * returns { text, seeds } or null when cancelled
   */
  async function askSeeds(what, def) {
    const S = require('./seeds');
    const info = vscode.InputBoxValidationSeverity ? vscode.InputBoxValidationSeverity.Info : undefined;
    const preview = seeds => seeds.length <= 6 ? seeds.join(', ') : `${seeds.slice(0, 3).join(', ')} … ${seeds[seeds.length - 1]}`;
    const text = await vscode.window.showInputBox({
      title: `Seeds for ${what}`,
      prompt: S.HELP,
      value: String(def),
      ignoreFocusOut: true,
      validateInput: v => {
        const r = S.parseSeeds(v);
        if (r.error) return r.error;
        const msg = `${r.seeds.length} run${r.seeds.length === 1 ? '' : 's'} per test: ${preview(r.seeds)}${/random|rand/i.test(v) ? ' (random seeds are recorded, so each run can be repeated)' : ''}`;
        return info ? { message: msg, severity: info } : null;
      }
    });
    if (text === undefined) return null;
    const r = S.parseSeeds(text);
    if (r.error || !r.seeds.length) { vscode.window.showErrorMessage('Seeds: ' + (r.error || 'none given')); return null; }
    return { text: text.trim(), seeds: r.seeds };
  }
  const seedArg = s => (/^-?\d+$/.test(s.text) ? `--seed ${s.text}` : `--seeds "${/random|rand/i.test(s.text) ? s.seeds.join(',') : s.text}"`);

  async function runCocotbTest(root, cfg) {
    const cr = require('./cocotbrun');
    const w = cr.where(root);
    if (!w.mode) { const a = await vscode.window.showWarningMessage('cocotb needs Python + cocotb: ' + w.reason, 'Set Up Toolchain'); if (a) vscode.commands.executeCommand('tenxDebug.toolchain.setup'); return; }
    const s = await vscode.window.showQuickPick([
      { label: '$(check) Icarus Verilog', description: w.mode === 'container' ? 'Docker toolchain' : 'local cocotb', v: 'icarus' },
      { label: '$(check) Verilator', description: (w.mode === 'container' ? 'Docker toolchain' : 'local cocotb') + ' · first build is slower', v: 'verilator' }
    ], { placeHolder: 'Run the cocotb testbench with which simulator?' });
    if (!s) return;
    const all = cr.listTests(root, cfg);
    const picked = await vscode.window.showQuickPick(all.map(t => ({ label: t, picked: true })), { placeHolder: 'cocotb tests to run', canPickMany: true, ignoreFocusOut: true });
    if (!picked || !picked.length) return;
    const sd = await askSeeds('cocotb (COCOTB_RANDOM_SEED)', cfg.seeds[0] || 1); if (!sd) return;
    const seeds = sd.seeds;
    if (!trusted()) return;
    out.show(true);
    out.appendLine(`\n> terminal equivalent: ${sim.IS_WIN ? '.\\dvflow.cmd' : './dvflow.sh'} cocotb --sim ${s.v} --tests ${picked.map(p => p.label).join(',')} ${seedArg(sd)}`);
    let res;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `cocotb on ${s.v}`, cancellable: true }, async (prog, token) => {
      try { res = await cr.run(root, cfg, { sim: s.v, tests: picked.map(p => p.label), seeds, token, log: l => { out.appendLine(l); if (/^\[(PASS|FAIL|ERROR|TIMEOUT)/.test(l)) prog.report({ message: l.replace(/\s+\(.*$/, '') }); } }); }
      catch (e) { out.appendLine('cocotb: ' + e.message); fail('cocotb run failed', e); }
    });
    if (!res) return;
    const bad = res.runs.find(r => r.status !== 'PASS');
    (bad ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(`cocotb ${cfg.dut.top} on ${s.v}: ${res.totals.pass}/${res.totals.runs} passed${bad ? ` — ${bad.status}: ${bad.firstError}` : ''}`, 'Open Dashboard', 'Open Test File').then(a => {
      if (a === 'Open Dashboard') openDashboard(root, res.runId);
      if (a === 'Open Test File') vscode.window.showTextDocument(vscode.Uri.file(path.join(root, 'cocotb', `test_${cfg.dut.top}.py`)));
    });
    return res;
  }

  async function runUvmTest(root, cfg) {
    const simId = await pickSimulator('uvm', 'questa'); if (!simId) return;
    const uvm = require('./uvmrun');
    const classes = uvm.listTests(root, cfg);
    const items = cfg.tests.map(t => ({ label: t, description: uvm.testName(cfg, t), v: t })).concat(classes.filter(c => !cfg.tests.some(t => uvm.testName(cfg, t) === c)).map(c => ({ label: c, description: 'UVM test class', v: c })));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'UVM tests to run (+UVM_TESTNAME) — select one or more', canPickMany: true, ignoreFocusOut: true });
    if (!picked || !picked.length) return;
    const tp = { v: picked.map(p => p.v).join(','), list: picked.map(p => p.v) };
    const sd = await askSeeds('the UVM tests (-sv_seed)', cfg.seeds[0] || 1); if (!sd) return;
    const seeds = sd.seeds;
    const covOn = await pickCoverage(simId, true); if (covOn == null) return;
    if (!trusted()) return;
    out.show(true);
    out.appendLine(`\n> terminal equivalent: ${sim.IS_WIN ? '.\\dvflow.cmd' : './dvflow.sh'} uvm --sim ${simId} --tests ${tp.v} ${seedArg(sd)} --cov ${covOn}`);
    let res;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `UVM: ${tp.v} on ${simId}`, cancellable: true }, async (prog, token) => {
      try {
        res = await uvm.run(root, cfg, { sim: simId, tests: tp.list, seeds, token, cov: covOn, timeoutS: cfgv().get('dv.timeoutSeconds', 300), override: { [simId]: simId === 'questa' && settings().questaBin ? { bin: settings().questaBin } : simId === 'vcs' && settings().vcsBin ? { bin: settings().vcsBin } : {} },
          log: s => { out.appendLine(s); if (/^\[(PASS|FAIL|ERROR|TIMEOUT|BLOCKED|INCOMPLETE)/.test(s)) prog.report({ message: s.replace(/\s+\(.*$/, '') }); } });
      } catch (e) { out.appendLine('dvflow uvm: ' + e.message); fail('UVM run failed', e); }
    });
    if (!res) return;
    const bad = res.results.find(r => r.status !== 'PASS');
    const cv = res.coverage;
    const covTxt = cv ? (cv.state === 'reported' ? ` · code ${cv.code.pct == null ? 'n/a' : cv.code.pct + '%'} · covergroups ${cv.covergroups.pct == null ? 'n/a' : cv.covergroups.pct + '%'}` : ` · coverage ${cv.state}`) : '';
    const msg = `UVM ${cfg.dut.top} on ${res.simLabel}: ${res.totals.pass}/${res.totals.runs} passed${covTxt}${bad ? ` — ${bad.status}: ${bad.why}` : ''}`;
    const acts = (res.report ? ['Open Dashboard'] : []).concat(['Open Log', 'Reveal Run Folder']).concat(cv && cv.files && cv.files.html ? ['Open Coverage Report'] : []);
    (bad ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(msg, ...acts).then(x => {
      const lf = (bad || res.results[0] || {}).log;
      if (x === 'Open Dashboard') openDashboard(root, res.runId);
      if (x === 'Open Coverage Report') vscode.env.openExternal(vscode.Uri.file(cv.files.html));
      if (x === 'Open Log' && lf) vscode.window.showTextDocument(vscode.Uri.file(lf));
      if (x === 'Reveal Run Folder') vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.join(res.runDir, 'uvm_results.json')));
    });
  }

  async function runTest() {
    const root = await pickProject(); if (!root) return;
    const cfg = runner.loadConfig(root);
    const hasUvm = require('./layout').hasUvm(root);
    const hasCocotb = fs.existsSync(path.join(root, 'cocotb', 'Makefile'));
    const kinds = [{ label: '$(beaker) Simple testbench (lightweight SV)', description: 'Icarus · Questa · VCS · Verilator', v: 'lightweight' }]
      .concat(hasUvm ? [{ label: '$(layers) UVM testbench', description: 'Questa · VCS · Verilator', v: 'uvm' }] : [])
      .concat(hasCocotb ? [{ label: '$(symbol-method) cocotb testbench (Python)', description: 'Icarus · Verilator — Docker toolchain or local cocotb', v: 'cocotb' }] : []);
    const kind = kinds.length > 1 ? await vscode.window.showQuickPick(kinds, { placeHolder: 'Which testbench do you want to run?', ignoreFocusOut: true }) : kinds[0];
    if (!kind) return;
    if (kind.v === 'uvm') return runUvmTest(root, cfg);
    if (kind.v === 'cocotb') return runCocotbTest(root, cfg);
    const simId = await pickSimulator('lightweight', cfg.simulator); if (!simId) return;
    const test = await vscode.window.showQuickPick(cfg.tests, { placeHolder: 'Test' }); if (!test) return;
    const sd = await askSeeds(`'${test}'`, cfg.seeds[0] || 1); if (!sd) return;
    const seeds = sd.seeds;
    const conf = cfg.configs.length > 1 ? await vscode.window.showQuickPick(cfg.configs.map(c => ({ label: c.name, description: JSON.stringify(c.params) })), { placeHolder: 'DUT configuration' }) : { label: cfg.configs[0].name };
    if (!conf) return;
    const w = await vscode.window.showQuickPick([{ label: 'Only if the test fails', description: 'recommended: fast passing runs; a failing run is repeated with the same seed and waves.vcd', v: 'fail' }, { label: 'Always', description: 'waves.vcd for every run', v: 1 }, { label: 'Never', v: 0 }], { placeHolder: 'Waveform (waves.vcd)' }); if (!w) return;
    const covOn = await pickCoverage(simId, false); if (covOn == null) return;
    out.appendLine(`> terminal equivalent: ${sim.IS_WIN ? '.\\dvflow.cmd' : './dvflow.sh'} run --sim ${simId} --test ${test} ${seedArg(sd)} --config ${conf.label} --waves ${w.v} --cov ${covOn}`);
    return execute(root, { sim: simId, tests: [test], seeds, configs: [conf.label], waves: w.v, cov: covOn, suite: 'single' }, `DV: ${test} on ${simId} × ${seeds.length} run(s)`);
  }

  async function runRegression() {
    const root = await pickProject(); if (!root) return;
    const cfg = runner.loadConfig(root);
    const suite = await vscode.window.showQuickPick(Object.entries(cfg.suites).map(([k, v]) => ({ label: k, description: v.join(', ') })), { placeHolder: 'Suite' }); if (!suite) return;
    const sdr = await askSeeds(`the '${suite.label}' regression`, cfg.seeds.join(',')); if (!sdr) return;
    const confs = cfg.configs.length > 1 ? await vscode.window.showQuickPick(cfg.configs.map(c => ({ label: c.name, description: JSON.stringify(c.params), picked: true })), { canPickMany: true, placeHolder: 'Parameter sweep: configurations to run' }) : [{ label: cfg.configs[0].name }];
    if (!confs || !confs.length) return;
    const caps = sim.capabilities(settings());
    const simPick = await vscode.window.showQuickPick(caps.map(c => ({ label: c.label, description: c.available ? c.version : 'unavailable — ' + c.reason, id: c.id, available: c.available })), { placeHolder: 'Simulator' });
    if (!simPick) return;
    if (!simPick.available) { vscode.window.showErrorMessage(`${simPick.label} is unavailable on this machine.`); return; }
    const sd = sdr.seeds;
    const covOn = await pickCoverage(simPick.id, false); if (covOn == null) return;
    out.appendLine(`> terminal equivalent: ${sim.IS_WIN ? '.\\dvflow.cmd' : './dvflow.sh'} regress --sim ${simPick.id} --suite ${suite.label} ${seedArg(sdr).replace(/^--seed /, '--seeds ')} --configs ${confs.map(c => c.label).join(',')} --cov ${covOn}`);
    return execute(root, { sim: simPick.id, suite: suite.label, seeds: sd, configs: confs.map(c => c.label), cov: covOn }, `DV regression: ${suite.label}`);
  }

  /* ---------------------------------------------------------------- dashboard */
  function latestRun(root) { const f = path.join(root, 'runs', 'latest.txt'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null; }
  let dashPanel = null;
  async function openDashboard(rootArg, runArg) {
    const root = rootArg || await pickProject(); if (!root) return;
    const runId = runArg || latestRun(root);
    if (!runId) { vscode.window.showWarningMessage('No runs yet.'); return; }
    const file = path.join(root, 'runs', runId, 'report', 'index.html');
    if (!fs.existsSync(file)) { vscode.window.showWarningMessage('Report not found: ' + file); return; }
    if (!dashPanel) {
      dashPanel = vscode.window.createWebviewPanel('tenxDebug.dvDashboard', 'DV Dashboard', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
      dashPanel.onDidDispose(() => { dashPanel = null; });
      dashPanel.webview.onDidReceiveMessage(m => {
        if (m.type === 'open') {
          const target = path.resolve(path.dirname(dashPanel._file), decodeURIComponent(m.href.split('#')[0]));
          const line = /#L(\d+)/.exec(m.href);
          if (!fs.existsSync(target)) { vscode.window.showWarningMessage('Not found: ' + target); return; }
          if (fs.statSync(target).isDirectory()) { vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target)); return; }
          // another run's dashboard (History tab): show it in this panel
          const rm = /[\\/]runs[\\/]([^\\/]+)[\\/]report[\\/]index\.html$/i.exec(target);
          if (rm) { openDashboard(path.resolve(target, '..', '..', '..', '..'), rm[1]); return; }
          if (/\.html$/i.test(target)) { openHtmlPanel(target); return; }
          if (/\.vcd$/i.test(target)) { vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(target), 'tenxDebug.waveform'); return; }
          if (/\.md$/i.test(target)) { vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(target)); return; }
          vscode.window.showTextDocument(vscode.Uri.file(target), line ? { selection: new vscode.Range(+line[1] - 1, 0, +line[1] - 1, 0) } : {});
        }
        if (m.type === 'browser') vscode.env.openExternal(vscode.Uri.file(dashPanel._file));
        // "Rerun with waves" from the run detail panel: same simulator, test, seed and configuration
        if (m.type === 'rerun' && (m.kind === 'uvm' || m.kind === 'cocotb')) {
          if (!trusted()) return;
          const root = path.resolve(path.dirname(dashPanel._file), '..', '..', '..');
          const cfg = runner.loadConfig(root);
          // the page is a file in the workspace: accept only simulators and tests this project really has
          const sims = m.kind === 'uvm' ? ['questa', 'vcs', 'verilator'] : ['icarus', 'verilator'];
          const known = m.kind === 'uvm' ? require('./uvmrun').listTests(root, cfg) : (require('./cocotbrun').listTests ? require('./cocotbrun').listTests(root, cfg) : cfg.tests);
          if (!sims.includes(m.sim) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(m.test)) || (known.length && !known.includes(m.test) && !known.some(k => k.endsWith('_' + m.test)) && !cfg.tests.includes(m.test))) {
            vscode.window.showWarningMessage(`Rerun refused: unknown simulator or test (${m.sim} / ${m.test}).`); return;
          }
          out.show(true);
          vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Rerun ${m.kind}: ${m.test} seed ${m.seed}`, cancellable: true }, async (prog, token) => {
            const o = { sim: m.sim, tests: [m.test], seeds: [Number(m.seed)], token, settings: settings(), log: s => out.appendLine(s) };
            try {
              const res = m.kind === 'uvm' ? await require('./uvmrun').run(root, cfg, o) : await require('./cocotbrun').run(root, cfg, o);
              if (res && res.runId) openDashboard(root, res.runId);
            } catch (e) { vscode.window.showErrorMessage('Rerun failed: ' + e.message); }
          });
          return;
        }
        if (m.type === 'rerun') {
          const root = path.resolve(path.dirname(dashPanel._file), '..', '..', '..');
          out.appendLine(`> terminal equivalent: ${sim.IS_WIN ? '.\\dvflow.cmd' : './dvflow.sh'} run --sim ${m.sim} --test ${m.test} --seed ${m.seed} --config ${m.config} --waves 1`);
          execute(root, { sim: m.sim, tests: [m.test], seeds: [Number(m.seed)], configs: [m.config], waves: 1, suite: 'rerun' }, `DV rerun: ${m.test} seed ${m.seed}`)
            .then(res => { if (res && res.meta) openDashboard(root, res.meta.runId); });
        }
      });
    }
    dashPanel._file = file;
    dashPanel.title = `DV Dashboard — ${runId}`;
    let html = fs.readFileSync(file, 'utf8');
    html = html.replace('</body>', `<script>const vs = acquireVsCodeApi();window.__dvVs = vs;document.body.classList.add('in-vscode');document.addEventListener('click', e => { const a = e.target.closest('a[href]'); if (!a) return; const h = a.getAttribute('href'); if (/^https?:/.test(h)) return; e.preventDefault(); vs.postMessage({ type: 'open', href: h }); }, true);
const b = document.createElement('button'); b.textContent = 'Open in browser'; b.onclick = () => vs.postMessage({ type: 'browser' }); const slot = document.getElementById('host-actions'); if (slot) { b.className = 'btn'; slot.appendChild(b); } else { b.style.cssText = 'position:fixed;top:14px;right:18px'; document.body.appendChild(b); }</script></body>`);
    dashPanel.webview.html = html;
    dashPanel.reveal();
  }

  /* ---------------------------------------------------------------- demo project + Demo Tour */
  const DEMO_MARK = '.10xeda-demo';
  async function createDemo() {
    const def = path.join(require('os').homedir(), '10xEDA-demo');
    const dir = await vscode.window.showInputBox({ prompt: 'Folder for the demo project (created if needed): a 4-bit adder with SV, UVM and cocotb testbenches', value: def, ignoreFocusOut: true });
    if (!dir) return;
    if (fs.existsSync(path.join(dir, 'dvflow.json'))) {
      const a = await vscode.window.showWarningMessage(`${dir} already has a DV project. Replace it with the demo?`, { modal: true }, 'Replace');
      if (a !== 'Replace') return;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(context.extensionUri.fsPath, 'examples', 'demo', 'adder.sv'), path.join(dir, 'adder.sv'));
      const r = require('./demo').init(dir, 'adder.sv', { top: 'adder4', mode: 'all', engineSrc, runtime: process.execPath });
      fs.writeFileSync(path.join(dir, DEMO_MARK), JSON.stringify({ created: new Date().toISOString(), dut: 'adder.sv' }, null, 2));
      await context.globalState.update('tenxDebug.demo.last', path.resolve(dir));   // "Open the demo project" finds it again later
      out.appendLine(`[demo] ${dir}: ${r.files.length} files generated (template ${r.cfg.template})`);
    } catch (e) { vscode.window.showErrorMessage('Could not create the demo: ' + e.message); return; }
    const open = (vscode.workspace.workspaceFolders || []).some(f => path.resolve(f.uri.fsPath).toLowerCase() === path.resolve(dir).toLowerCase());
    if (open) openTour(dir);
    else { await context.globalState.update('tenxDebug.demo.openTourFor', path.resolve(dir)); vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), { forceNewWindow: false }); }
  }

  let tour = null;
  function tourState(root) {
    let cfg = null; try { cfg = runner.loadConfig(root); } catch (e) { /* no project */ }
    return { root, dutFile: cfg ? cfg.dut.files[0] : '?', bug: cfg ? require('./demo').bugActive(root, cfg) : false, done: context.workspaceState.get('tenxDebug.demo.done:' + root, {}) };
  }
  async function openTour(rootArg) {
    const root = rootArg || await pickProject(); if (!root) return;
    if (!tour) {
      tour = vscode.window.createWebviewPanel('tenxDebug.demoTour', 'Demo Tour', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
      tour.onDidDispose(() => { tour = null; });
      tour.webview.onDidReceiveMessage(async m => {
        if (m.type !== 'act') return;
        const r = tour._root;
        let ok = false;
        try { ok = await tourAction(r, m.id); } catch (e) { vscode.window.showErrorMessage(`Demo step failed: ${e.message}`); }
        if (ok && m.id !== 'dashboard') { const d = context.workspaceState.get('tenxDebug.demo.done:' + r, {}); d[m.id] = true; await context.workspaceState.update('tenxDebug.demo.done:' + r, d); }
        if (tour) tour.webview.html = require('./tourpage').html(tourState(r));
      });
    }
    tour._root = root;
    tour.webview.html = require('./tourpage').html(tourState(root));
    tour.reveal(vscode.ViewColumn.One);
  }
  /** run a step with a progress notification; true when it completed */
  function step(title, fn) {
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (prog, token) => {
      out.show(true);
      return fn(token, s => { out.appendLine(s); const mm = /^\[([A-Z]+|\w+)\s*\]?\s*(.{0,80})/.exec(s); if (mm) prog.report({ message: s.slice(0, 90) }); });
    });
  }
  async function tourAction(root, id) {
    const cfg = runner.loadConfig(root);
    const demo = require('./demo');
    const regress = async (sim, extra, title) => {
      const res = await execute(root, Object.assign({ sim, suite: 'full', seeds: cfg.seeds, waves: 1 }, extra || {}), title);
      if (res) openDashboard(root, res.meta.runId);
      return !!res;
    };
    switch (id) {
      case 'tools': await vscode.commands.executeCommand('tenxDebug.toolchain.status'); return true;
      case 'files': {
        await vscode.window.showTextDocument(vscode.Uri.file(require('./layout').planYaml(root)), { viewColumn: vscode.ViewColumn.Beside, preview: false });
        vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(path.join(root, 'uvm')));
        return true;
      }
      case 'regress': return regress('icarus', {}, 'Demo: regression on Icarus');
      case 'dashboard': await openDashboard(root); return true;
      case 'coverage': return regress('verilator', { seeds: [cfg.seeds[0]], cov: 1 }, 'Demo: Verilator with code coverage');
      case 'uvm': {
        vscode.commands.executeCommand('tenxDebug.uvmArchitecture');
        const res = await step('Demo: UVM on Verilator (first build ~1 min)', (token, log) => require('./uvmrun').run(root, cfg, { sim: 'verilator', tests: cfg.tests, seeds: [cfg.seeds[0]], token, log, settings: settings() }));
        if (res && res.runId && res.report) openDashboard(root, res.runId);
        return !!res;
      }
      case 'cocotb': {
        const res = await step('Demo: cocotb on Icarus', (token, log) => require('./cocotbrun').run(root, cfg, { sim: 'icarus', seeds: [cfg.seeds[0]], token, log }));
        if (res && res.runId) openDashboard(root, res.runId);
        return !!res;
      }
      case 'bug': {
        const b = demo.injectBug(root, cfg);
        if (!b.already) vscode.window.showInformationMessage(`Bug planted in ${path.basename(b.file)}: ${b.what}`);
        await vscode.window.showTextDocument(vscode.Uri.file(b.file), { viewColumn: vscode.ViewColumn.Beside, preview: true });
        return regress('icarus', {}, 'Demo: regression with the bug');
      }
      case 'formal': {
        const R = await step('Demo: formal proof', (token, log) => require('./signoff').run(root, { steps: ['formal'], token, log }));
        if (!R) return false;
        openHtmlPanel(R.report, 'Formal proof');
        const f = R.results.formal || {};
        if (f.prove && f.prove.trace) vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(root, f.prove.trace)), 'tenxDebug.waveform');
        return true;
      }
      case 'fix': {
        if (!demo.restore(root, cfg)) vscode.window.showInformationMessage('No demo bug to remove: the DUT is already the original.');
        return regress('icarus', {}, 'Demo: regression after the fix');
      }
      case 'mutation': {
        const res = await step('Demo: mutation testing', (token, log) => require('./mutate').run(root, { sim: 'icarus', max: 40, token, log, settings: settings() }));
        if (!res) return false;
        try { const lid = latestRun(root); if (lid) require('./report').write(root, JSON.parse(fs.readFileSync(path.join(root, 'runs', lid, 'results.json'), 'utf8'))); } catch (e) { /* optional */ }
        openHtmlPanel(res.report, 'Mutation testing');
        return true;
      }
      case 'signoff': {
        const R = await step('Demo: sign-off check', (token, log) => require('./signoff').run(root, { glsSim: 'icarus', token, log }));
        if (!R) return false;
        try { const lid = latestRun(root); if (lid) require('./report').write(root, JSON.parse(fs.readFileSync(path.join(root, 'runs', lid, 'results.json'), 'utf8'))); } catch (e) { /* optional */ }
        openHtmlPanel(R.report, 'Sign-off');
        return true;
      }
    }
    return false;
  }
  // a demo folder opened by "Create Demo Project" (or opened again): show the tour once per window
  setTimeout(() => {
    const want = context.globalState.get('tenxDebug.demo.openTourFor');
    for (const f of vscode.workspace.workspaceFolders || []) {
      const p = path.resolve(f.uri.fsPath);
      if (fs.existsSync(path.join(p, DEMO_MARK)) && (want === p || !context.workspaceState.get('tenxDebug.demo.seen'))) {
        context.globalState.update('tenxDebug.demo.openTourFor', undefined);
        context.workspaceState.update('tenxDebug.demo.seen', true);
        openTour(p);
        break;
      }
    }
  }, 1500);

  /* ---------------------------------------------------------------- standalone HTML reports (mutation testing, …) */
  let htmlPanel = null;
  function openHtmlPanel(file, title) {
    if (!htmlPanel) {
      htmlPanel = vscode.window.createWebviewPanel('tenxDebug.dvReport', title || path.basename(file), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
      htmlPanel.onDidDispose(() => { htmlPanel = null; });
      htmlPanel.webview.onDidReceiveMessage(m => {
        if (m.type !== 'open') return;
        const target = path.resolve(path.dirname(htmlPanel._file), decodeURIComponent(m.href.split('#')[0]));
        const line = /#L(\d+)/.exec(m.href);
        if (!fs.existsSync(target)) { vscode.window.showWarningMessage('Not found: ' + target); return; }
        // the right viewer for each kind of artefact a report links to
        const rm = /[\\/]runs[\\/]([^\\/]+)[\\/]report[\\/]index\.html$/i.exec(target);
        if (rm) { openDashboard(path.resolve(target, '..', '..', '..', '..'), rm[1]); return; }
        if (/\.vcd$/i.test(target)) { vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(target), 'tenxDebug.waveform'); return; }
        if (/_netlist\.json$/i.test(target)) { vscode.commands.executeCommand('tenxDebug.netlist.open', vscode.Uri.file(target)); return; }
        vscode.window.showTextDocument(vscode.Uri.file(target), line ? { selection: new vscode.Range(+line[1] - 1, 0, +line[1] - 1, 0) } : {});
      });
    }
    htmlPanel._file = file;
    htmlPanel.title = title || path.basename(path.dirname(file));
    htmlPanel.webview.html = fs.readFileSync(file, 'utf8').replace('</body>', `<script>const vs = acquireVsCodeApi();document.addEventListener('click', e => { const a = e.target.closest('a[href]'); if (!a) return; const h = a.getAttribute('href'); if (/^https?:/.test(h)) return; e.preventDefault(); vs.postMessage({ type: 'open', href: h }); }, true);</script></body>`);
    htmlPanel.reveal();
  }

  /* ---------------------------------------------------------------- synthesis, gate-level simulation, LEC, formal, sign-off */
  async function signoff(preset) {
    const root = await pickProject(); if (!root) return;
    const so = require('./signoff');
    let steps = preset;
    if (!steps) {
      const picks = await vscode.window.showQuickPick([
        { label: 'Lint', description: 'Verilator -Wall on the DUT', v: 'lint', picked: true },
        { label: 'Synthesis', description: 'Yosys: cells, flip-flops, inferred latches, logic depth, gate netlist', v: 'synth', picked: true },
        { label: 'Logic equivalence', description: 'RTL vs gate netlist, formally', v: 'lec', picked: true },
        { label: 'Gate-level simulation', description: 'the testbench re-run on the gate netlist', v: 'gls', picked: true },
        { label: 'Formal proof', description: 'DUT = reference model for every input sequence; coverage bins reachable', v: 'formal', picked: true }
      ], { placeHolder: 'Sign-off checks to run (open-source tools, no license)', canPickMany: true, ignoreFocusOut: true });
      if (!picks || !picks.length) return;
      steps = picks.map(p => p.v);
    }
    let glsSim = 'icarus';
    if (steps.includes('gls')) {
      const g = await vscode.window.showQuickPick([{ label: 'Icarus Verilog', v: 'icarus' }, { label: 'Verilator', v: 'verilator' }], { placeHolder: 'Simulator for the gate-level simulation' });
      if (!g) return; glsSim = g.v;
    }
    if (!trusted()) return;
    out.show(true);
    out.appendLine(`\n> terminal equivalent: ${sim.IS_WIN ? '.\\dvflow.cmd' : './dvflow.sh'} signoff --steps ${steps.join(',')}${steps.includes('gls') ? ' --gls-sim ' + glsSim : ''}`);
    let R;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: steps.length === 1 ? { synth: 'Synthesis', gls: 'Gate-level simulation', lec: 'Logic equivalence', formal: 'Formal proof', lint: 'Lint' }[steps[0]] : 'Sign-off check', cancellable: true }, async (prog, token) => {
      try { R = await so.run(root, { steps, glsSim, token, log: s => { out.appendLine(s); const m = /^\[(\w+)\]\s*(.{0,90})/.exec(s); if (m) prog.report({ message: `${m[1]}: ${m[2]}` }); } }); }
      catch (e) { out.appendLine('sign-off: ' + e.message); fail('Sign-off failed', e); }
    });
    if (!R) return;
    // refresh the latest dashboard so its Overview shows the sign-off panel
    try { const id = latestRun(root); if (id) require('./report').write(root, JSON.parse(fs.readFileSync(path.join(root, 'runs', id, 'results.json'), 'utf8'))); } catch (e) { /* optional */ }
    const r = R.results;
    const parts = Object.entries(r).map(([k, v]) => `${{ lint: 'lint', synth: 'synthesis', lec: 'LEC', gls: 'GLS', formal: 'formal' }[k]} ${v.verdict}`).join(' · ');
    const acts = ['Open Report'].concat(r.synth && r.synth.json ? ['Open Schematic'] : [], r.gls && r.gls.report ? ['GLS Dashboard'] : [], r.formal && r.formal.prove && r.formal.prove.trace ? ['Open Counterexample'] : []);
    (R.verdict === 'pass' ? vscode.window.showInformationMessage : vscode.window.showWarningMessage)(`Sign-off ${R.verdict === 'pass' ? 'ready' : R.verdict.toUpperCase()}: ${parts}`, ...acts).then(a => {
      if (a === 'Open Report') openHtmlPanel(R.report, 'Sign-off');
      if (a === 'Open Schematic') vscode.commands.executeCommand('tenxDebug.netlist.open', vscode.Uri.file(path.join(R.dir, r.synth.json)));
      if (a === 'GLS Dashboard') openDashboard(root, r.gls.runId);
      if (a === 'Open Counterexample') vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(root, r.formal.prove.trace)), 'tenxDebug.waveform');
    });
  }

  /* ---------------------------------------------------------------- mutation testing */
  async function mutationTest() {
    const root = await pickProject(); if (!root) return;
    const cfg = runner.loadConfig(root);
    const simId = await pickSimulator('lightweight', cfg.simulator); if (!simId) return;
    const n = await vscode.window.showQuickPick([
      { label: '20 mutants', description: 'quick look (~seconds on Icarus)', v: 20 },
      { label: '40 mutants', description: 'recommended', v: 40, picked: true },
      { label: '100 mutants', description: 'thorough', v: 100 },
      { label: 'All possible mutants', description: 'every operator in the DUT', v: 100000 }
    ], { placeHolder: 'Mutation testing: plant small bugs in copies of the DUT and check which ones the tests catch' });
    if (!n) return;
    if (!trusted()) return;
    out.show(true);
    out.appendLine(`\n> terminal equivalent: ${sim.IS_WIN ? '.\\dvflow.cmd' : './dvflow.sh'} mutate --sim ${simId} --max ${n.v}`);
    let res;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Mutation testing', cancellable: true }, async (prog, token) => {
      try {
        res = await require('./mutate').run(root, { sim: simId, max: n.v, token, settings: settings(),
          log: s => { out.appendLine(s); const mm = /^\[(\w+)\s*\] (m\d+)/.exec(s); if (mm) prog.report({ message: `${mm[2]}: ${mm[1].toLowerCase()}` }); } });
      } catch (e) { out.appendLine('mutation testing: ' + e.message); fail('Mutation testing failed', e); }
    });
    if (!res) return;
    // refresh the latest dashboard so its Overview shows the "Testbench quality" panel
    try { const id = latestRun(root); if (id) require('./report').write(root, JSON.parse(fs.readFileSync(path.join(root, 'runs', id, 'results.json'), 'utf8'))); } catch (e) { /* dashboard refresh is optional */ }
    const msg = `Mutation score ${res.score == null ? 'n/a' : res.score + '%'}: ${res.killed} caught, ${res.survived} missed, ${res.equivalent} equivalent, ${res.invalid} did not compile (${res.ran} mutants).`;
    (res.survived ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(msg, 'Open Report', 'Open Dashboard').then(a => {
      if (a === 'Open Report') openHtmlPanel(res.report, 'Mutation testing');
      if (a === 'Open Dashboard') openDashboard(root);
    });
  }

  /* ---------------------------------------------------------------- failures */
  function loadResults(root, runId) { const id = runId || latestRun(root); if (!id) return null; const f = path.join(root, 'runs', id, 'results.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; }
  async function pickFailure(root, res) {
    res = res || loadResults(root);
    const fails = res ? res.runs.filter(r => r.failureDir) : [];
    if (!fails.length) { vscode.window.showInformationMessage('No failures in the latest run.'); return null; }
    const p = fails.length === 1 ? { r: fails[0] } : await vscode.window.showQuickPick(fails.map(r => ({ label: `${r.test} · seed ${r.seed}${res.meta.configs.length > 1 ? ' · ' + r.config : ''}`, description: `${r.status} — ${r.firstError || ''}`, r })), { placeHolder: 'Failed test' });
    return p ? { r: p.r, res } : null;
  }
  async function openFailure(rootArg, resArg) {
    const root = rootArg || await pickProject(); if (!root) return;
    const p = await pickFailure(root, resArg); if (!p) return;
    const dir = path.join(root, 'runs', p.res.meta.runId, p.r.failureDir);
    await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(path.join(dir, 'triage.md')));
    const a = await vscode.window.showInformationMessage(`Failure artifacts: ${vscode.workspace.asRelativePath(dir)}`, 'Open sim.log', 'Reveal folder', 'Rerun with waves', 'Summarize with AI');
    if (a === 'Open sim.log') vscode.window.showTextDocument(vscode.Uri.file(path.join(dir, 'sim.log')));
    if (a === 'Reveal folder') vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.join(dir, 'triage.md')));
    if (a === 'Rerun with waves') rerunFailed(root, p);
    if (a === 'Summarize with AI') aiSummarize(path.join(dir, 'triage.md'));
  }
  async function rerunFailed(rootArg, picked) {
    const root = rootArg || await pickProject(); if (!root) return;
    const p = picked || await pickFailure(root); if (!p) return;
    const w = picked ? { v: 1 } : await vscode.window.showQuickPick([{ label: 'With waveforms (original seed)', v: 1 }, { label: 'Without waveforms', v: 0 }], { placeHolder: 'Rerun' });
    if (!w) return;
    out.appendLine(`> terminal equivalent: ${sim.IS_WIN ? '.\\dvflow.cmd' : './dvflow.sh'} rerun --run ${p.res.meta.runId} --test ${p.r.test} --seed ${p.r.seed} --config ${p.r.config} --waves ${w.v}`);
    return execute(root, { sim: p.res.meta.simulator, tests: [p.r.test], seeds: [p.r.seed], configs: [p.r.config], waves: w.v, suite: 'rerun' }, `DV rerun: ${p.r.test} seed ${p.r.seed}`);
  }

  /* ---------------------------------------------------------------- capabilities */
  function showCaps() {
    out.show(true);
    out.appendLine('\nSimulator adapters (detected now):');
    for (const c of sim.capabilities(settings())) {
      out.appendLine(`  ${c.label.padEnd(20)} ${c.available ? 'available   ' + c.version : 'UNAVAILABLE ' + c.reason}`);
      Object.entries(c.caps).forEach(([k, v]) => out.appendLine(`      ${k.padEnd(22)} ${v}${c.notes && c.notes[k] ? '  (' + c.notes[k] + ')' : ''}`));
    }
  }

  /* ---------------------------------------------------------------- opt-in AI assistance (local by default) */
  async function aiGate(what, text) {
    if (!cfgv().get('dv.ai.enable', false)) { vscode.window.showInformationMessage('AI assistance is off. Enable "tenxDebug.dv.ai.enable" to use it; nothing is sent until you confirm each request.'); return null; }
    if (!vscode.lm || !vscode.lm.selectChatModels) { vscode.window.showWarningMessage('No language-model API in this editor.'); return null; }
    const ok = await vscode.window.showWarningMessage(`Send ${what} (${text.length} characters) to the editor's AI model? Nothing else (RTL, logs, reports) is sent.`, { modal: true }, 'Send');
    if (ok !== 'Send') return null;
    const [model] = await vscode.lm.selectChatModels({});
    if (!model) { vscode.window.showWarningMessage('No chat model available.'); return null; }
    return model;
  }
  async function aiAsk(model, prompt) {
    const r = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, new vscode.CancellationTokenSource().token);
    let s = '';
    for await (const f of r.text) s += f;
    return s;
  }
  async function aiSummarize(file) {
    if (!file) { const root = await pickProject(); if (!root) return; const p = await pickFailure(root); if (!p) return; file = path.join(root, 'runs', p.res.meta.runId, p.r.failureDir, 'triage.md'); }
    const text = fs.readFileSync(file, 'utf8');
    const model = await aiGate('this triage.md', text); if (!model) return;
    const s = await aiAsk(model, 'You are a design-verification engineer. Summarise this failure triage in 5 bullet points, keep hypotheses labelled as hypotheses, and propose the single next debug step.\n\n' + text);
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# AI summary (draft — verify against the evidence)\n\n' + s });
    vscode.window.showTextDocument(doc);
  }
  async function aiDraftScenarios() {
    const root = await pickProject(); if (!root) return;
    const cfg = runner.loadConfig(root);
    const spec = JSON.stringify({ template: cfg.template, behavior: cfg.behavior }, null, 2);
    const model = await aiGate('the behaviour spec from dvflow.json', spec); if (!model) return;
    const s = await aiAsk(model, 'Draft additional verification scenarios for this DUT behaviour spec. For each: id (SC-AI-xxx), title, concrete stimulus, expected result, and which requirement it checks. Output YAML list entries in the same shape as a testplan "scenarios" section.\n\n' + spec);
    const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content: '# AI-drafted scenarios (review before copying into testplan.yaml)\n' + s });
    vscode.window.showTextDocument(doc);
  }

  const reg = (id, fn) => sub(vscode.commands.registerCommand(id, fn));
  reg('tenxDebug.dv.selectDut', u => selectDut(u));
  reg('tenxDebug.dv.mutate', () => mutationTest());
  reg('tenxDebug.dv.signoff', () => signoff());
  reg('tenxDebug.demo.create', () => createDemo());
  reg('tenxDebug.demo.tour', () => openTour());
  reg('tenxDebug.dv.synth', () => signoff(['synth']));
  reg('tenxDebug.dv.gls', () => signoff(['synth', 'lec', 'gls']));
  reg('tenxDebug.dv.formalProve', () => signoff(['formal']));
  reg('tenxDebug.dv.fixQuotes', () => fixQuotes());
  reg('tenxDebug.dv.generateTestPlan', () => generate(true));
  reg('tenxDebug.dv.newFromLibrary', async () => {
    const L = require('./library');
    const all = L.list(context.extensionUri.fsPath);
    if (!all.length) { vscode.window.showWarningMessage('The design library is missing from this installation.'); return; }
    const cat = c => ({ gates: 'Logic gates', arithmetic: 'Arithmetic', mux_demux: 'Mux / demux', encode_decode: 'Encoders / decoders', coding: 'Codes: parity, CRC, Gray, Hamming', datapath: 'ALU / datapath', sequential: 'Flip-flops / registers / shifters', counters: 'Counters / LFSR / PC', memory: 'Memories / register files', fifo: 'FIFOs', fsm: 'State machines', protocols: 'Protocols: APB, AHB, AXI, SPI, I²C, UART, Wishbone' }[c] || c);
    const items = [];
    let last = null;
    for (const d of all) {
      if (d.category !== last) { items.push({ label: cat(d.category), kind: vscode.QuickPickItemKind.Separator }); last = d.category; }
      items.push({ label: d.name, description: d.title, detail: `template: ${d.meta.expected_template}${d.meta.protocol ? ' · protocol: ' + d.meta.protocol : ''} · proven against its spec`, d });
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: `New design from the library (${all.length} designs, each with a spec and a self-check)`, matchOnDescription: true, matchOnDetail: true });
    if (!pick || !pick.d) return;
    const base = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0] && vscode.workspace.workspaceFolders[0].uri.fsPath) || require('os').homedir();
    const target = await vscode.window.showInputBox({ prompt: 'Folder for the new project (design/, SPEC.md, testbenches, test plan)', value: path.join(base, pick.d.name), ignoreFocusOut: true });
    if (!target) return;
    if (!trusted()) return;
    try {
      const r = L.createProject(context.extensionUri.fsPath, pick.d, target, { initOpts: { engineSrc, runtime: process.execPath } });
      out.appendLine(`[library] ${pick.d.name} → ${r.root}: template ${r.template}, ${r.files.length} files generated`);
      if (fs.existsSync(path.join(r.root, 'SPEC.md'))) await vscode.window.showTextDocument(vscode.Uri.file(path.join(r.root, 'SPEC.md')), { preview: false });
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(r.root, 'design', pick.d.name + '.sv')), { viewColumn: vscode.ViewColumn.Beside, preview: false });
      const inWs = (vscode.workspace.workspaceFolders || []).some(f => r.root.toLowerCase().startsWith(f.uri.fsPath.toLowerCase()));
      const acts = r.runnable ? ['Run Regression'] : ['Write Expected Behaviour'];
      if (!inWs) acts.push('Open Folder');
      const a = await vscode.window.showInformationMessage(`${pick.d.name}: RTL, SPEC.md and testbenches are ready (template ${r.template}).${!r.runnable ? ' This design needs its expected behaviour written (its self-check testbench is in tb/selfcheck/).' : r.template === 'custom' ? ' Its expected behaviour was written from SPEC.md.' : ''}`, ...acts);
      if (a === 'Run Regression') vscode.commands.executeCommand('tenxDebug.dv.runRegression');
      else if (a === 'Write Expected Behaviour') vscode.commands.executeCommand('tenxDebug.dv.writeBehaviour');
      else if (a === 'Open Folder') vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(r.root), { forceNewWindow: false });
    } catch (e) { fail('New design from library', e); }
  });
  reg('tenxDebug.dv.writeBehaviour', async () => {
    const root = await pickProject(); if (!root) return;
    try {
      require('./behaviourform').openForm(root, { aiEnabled: () => cfgv().get('dv.ai.enable', false), aiGate, aiAsk, log: s => out.appendLine(s) });
    } catch (e) { fail('Write Expected Behaviour', e); }
  });
  reg('tenxDebug.dv.generateTestbench', () => generate(false));
  reg('tenxDebug.dv.runTest', runTest);
  reg('tenxDebug.dv.runRegression', runRegression);
  reg('tenxDebug.dv.openDashboard', () => openDashboard());
  reg('tenxDebug.dv.rerunFailed', () => rerunFailed());
  reg('tenxDebug.dv.openFailure', () => openFailure());
  reg('tenxDebug.dv.capabilities', showCaps);
  reg('tenxDebug.dv.exportTestPlanExcel', async () => {
    const root = await pickProject(); if (!root) return;
    const res = loadResults(root);
    if (!res) { vscode.window.showWarningMessage('Run a test first: the Excel test plan includes the latest results.'); return; }
    const f = require('./planxlsx').write(root, res);
    const a = await vscode.window.showInformationMessage(`Test plan exported: ${f}`, 'View in VS Code', 'Open in Excel', 'Reveal');
    if (a === 'View in VS Code') vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(f), 'tenxDebug.xlsxViewer');
    if (a === 'Open in Excel') vscode.env.openExternal(vscode.Uri.file(f));
    if (a === 'Reveal') vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(f));
  });
  reg('tenxDebug.dv.aiSummarize', () => aiSummarize());
  reg('tenxDebug.dv.aiDraftScenarios', aiDraftScenarios);
  // 10xEngineer RTL Regression Explorer (Test Explorer), simulator setup, formal
  try { require('./explorer').register(context, out); } catch (e) { out.appendLine('RTL Regression Explorer unavailable: ' + e.message); }
}

module.exports = { register };

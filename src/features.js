'use strict';
/* Coverage dashboard, editor coverage highlighting, Questa integration, UVM wizard and source-list tools. */
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const coverage = require('./coverage');
const questa = require('./questa');
const hdl = require('./hdlparse');
const uvmgen = require('./uvmgen');
const vplan = require('./vplan');
const cp = require('child_process');

/** License env vars are sometimes set with literal quotes, which FlexLM cannot read. */
function simEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  for (const k of ['MGLS_LICENSE_FILE', 'LM_LICENSE_FILE', 'SALT_LICENSE_SERVER']) if (env[k]) env[k] = env[k].replace(/^"(.*)"$/, '$1');
  return env;
}

const COV_EXTS = ['ucdb', 'txt', 'rpt', 'log', 'info', 'dat', 'json'];

function register(context, h) {
  const { cfg, nonce, csp, revealLine } = h;
  const sub = d => context.subscriptions.push(d);
  const out = vscode.window.createOutputChannel('10xEngineers EDA');
  sub(out);

  /* ================================================================ coverage state */
  const cov = { panel: null, file: null, model: null, resolved: new Map(), highlight: false, planFile: null, plan: null, regression: null };

  function planEval() {
    if (!cov.plan || !cov.model) return null;
    try { return vplan.evaluate(cov.plan, cov.model, cov.regression); } catch (e) { return null; }
  }

  async function loadPlan(file, silent) {
    try {
      cov.plan = vplan.loadPlanText(fs.readFileSync(file, 'utf8'), file);
      cov.planFile = file;
      if (!silent) vscode.window.setStatusBarMessage(`Testplan loaded: ${cov.plan.length} features`, 3000);
      postModel();
      covTreeRefresh();
    } catch (e) { if (!silent) vscode.window.showErrorMessage('Could not read testplan: ' + e.message); }
  }

  async function autoFindPlan(near) {
    if (cov.planFile && fs.existsSync(cov.planFile)) return;
    const dirs = [];
    let d = path.dirname(near);
    for (let k = 0; k < 4; k++) { dirs.push(d); d = path.dirname(d); }
    for (const dir of dirs) {
      try {
        const f = fs.readdirSync(dir).find(x => /\.testplan$|^(vplan|testplan|verification_plan).*\.(csv|ya?ml)$/i.test(x));
        if (f) { await loadPlan(path.join(dir, f), true); return; }
      } catch (e) { /* ignore */ }
    }
  }
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'tenxDebug.coverageDashboard';
  sub(status);

  const decoUncovered = vscode.window.createTextEditorDecorationType({
    isWholeLine: true, backgroundColor: 'rgba(208,59,59,0.14)', overviewRulerColor: 'rgba(208,59,59,0.9)', overviewRulerLane: vscode.OverviewRulerLane.Left,
    borderWidth: '0 0 0 3px', borderStyle: 'solid', borderColor: 'rgba(208,59,59,0.9)'
  });
  const decoCovered = vscode.window.createTextEditorDecorationType({
    isWholeLine: true, borderWidth: '0 0 0 3px', borderStyle: 'solid', borderColor: 'rgba(12,163,12,0.75)', overviewRulerColor: 'rgba(12,163,12,0.5)', overviewRulerLane: vscode.OverviewRulerLane.Left
  });
  sub(decoUncovered); sub(decoCovered);

  async function resolveSource(file) {
    if (!file) return null;
    if (cov.resolved.has(file)) return cov.resolved.get(file);
    const tries = [];
    if (path.isAbsolute(file)) tries.push(file);
    if (cov.file) tries.push(path.resolve(path.dirname(cov.file), file));
    (vscode.workspace.workspaceFolders || []).forEach(w => tries.push(path.resolve(w.uri.fsPath, file)));
    let hit = tries.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
    if (!hit) {
      const found = await vscode.workspace.findFiles('**/' + path.basename(file), '**/node_modules/**', 5);
      const parts = file.replace(/\\/g, '/').split('/').filter(p => p && p !== '..' && p !== '.');
      found.sort((a, b) => score(b) - score(a));
      function score(u) { const s = u.fsPath.replace(/\\/g, '/'); return parts.filter(p => s.includes('/' + p)).length; }
      if (found.length) hit = found[0].fsPath;
    }
    cov.resolved.set(file, hit || null);
    return hit || null;
  }

  async function applyDecorations() {
    const eds = vscode.window.visibleTextEditors;
    if (!cov.highlight || !cov.model) { eds.forEach(e => { e.setDecorations(decoUncovered, []); e.setDecorations(decoCovered, []); }); return; }
    const byPath = new Map();
    for (const f of Object.keys(cov.model.code)) {
      const p = await resolveSource(f);
      if (p) byPath.set(path.resolve(p).toLowerCase(), cov.model.code[f]);
    }
    for (const e of eds) {
      const lines = byPath.get(path.resolve(e.document.uri.fsPath).toLowerCase());
      if (!lines) { e.setDecorations(decoUncovered, []); e.setDecorations(decoCovered, []); continue; }
      const unc = [], ok = [];
      for (const [l, v] of Object.entries(lines)) {
        const ln = +l - 1;
        if (ln < 0 || ln >= e.document.lineCount) continue;
        const d = { range: e.document.lineAt(ln).range, hoverMessage: `**10x coverage** · ${v.kind === 'branch' ? 'branch' : 'statement'} hits: **${v.hits}**${v.partial ? ' (some branches missed)' : ''}` };
        (v.hits ? ok : unc).push(d);
      }
      e.setDecorations(decoUncovered, unc);
      e.setDecorations(decoCovered, ok);
    }
  }
  sub(vscode.window.onDidChangeVisibleTextEditors(applyDecorations));

  function historyKey(file) { return 'covhist:' + path.dirname(file).toLowerCase(); }
  function recordHistory(file, m) {
    if (m.total == null) return [];
    const key = historyKey(file);
    const list = context.workspaceState.get(key, []);
    const st = fs.statSync(file);
    const entry = { date: st.mtimeMs, total: m.total, name: path.basename(file) };
    if (!list.some(x => x.date === entry.date && x.name === entry.name)) list.push(entry);
    list.sort((a, b) => a.date - b.date);
    while (list.length > 50) list.shift();
    context.workspaceState.update(key, list);
    return list;
  }

  async function questaBin(interactive) {
    let bin = questa.normalize(cfg().get('questa.path', ''));
    if (bin) return bin;
    const det = questa.detect();
    if (det.length) {
      if (!cfg().get('questa.path')) await cfg().update('questa.path', det[0], vscode.ConfigurationTarget.Global);
      return det[0];
    }
    if (interactive) {
      const pick = await vscode.window.showWarningMessage('QuestaSim/ModelSim was not found. Set its install path?', 'Configure Path');
      if (pick) return configureQuesta();
    }
    return null;
  }

  async function ucdbToReport(ucdb) {
    const bin = await questaBin(true);
    if (!bin) throw new Error('Questa (vcover) is needed to read .ucdb files. Run "10xEngineers EDA: Configure Questa Path".');
    const outFile = ucdb.replace(/\.ucdb$/i, '') + '_report.txt';
    const args = ['report', ...cfg().get('questa.reportArgs', ['-details']), '-output', outFile, ucdb];
    out.appendLine(`> ${questa.binPath(bin, 'vcover')} ${args.join(' ')}`);
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'vcover report ' + path.basename(ucdb) }, () => questa.run(bin, 'vcover', args, path.dirname(ucdb)));
    out.append(r.out);
    if (!fs.existsSync(outFile)) { out.show(true); throw new Error('vcover report failed — see the "10xEngineers EDA" output channel.'); }
    return outFile;
  }

  async function openCoverage(uri) {
    let file = uri instanceof vscode.Uri ? uri.fsPath : (typeof uri === 'string' ? uri : null);
    if (!file) {
      const pick = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { 'Coverage (UCDB, vcover report, LCOV, Verilator, JSON)': COV_EXTS, 'All files': ['*'] }, openLabel: 'Open Coverage' });
      if (!pick || !pick.length) return;
      if (pick.length > 1 && pick.every(p => /\.ucdb$/i.test(p.fsPath))) return mergeUcdbs(pick.map(p => p.fsPath));
      file = pick[0].fsPath;
    }
    try {
      if (/\.ucdb$/i.test(file)) file = await ucdbToReport(file);
      const model = coverage.parseFile(file);
      cov.file = file; cov.model = model; cov.resolved.clear();
      await autoFindPlan(file);
      covTreeRefresh();
      publishTestingCoverage();
      const hist = recordHistory(file, model);
      showPanel();
      postModel(hist);
      status.text = `$(shield) Cov ${model.total != null ? model.total.toFixed(1) + '%' : 'n/a'}`;
      status.tooltip = `10xEngineers EDA coverage — ${path.basename(file)} (click for dashboard)`;
      status.show();
      applyDecorations();
    } catch (e) {
      vscode.window.showErrorMessage('10xEngineers EDA coverage: ' + (e.message || e));
    }
  }

  async function mergeUcdbs(files) {
    const bin = await questaBin(true);
    if (!bin) return;
    const outU = path.join(path.dirname(files[0]), 'merged.ucdb');
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `vcover merge (${files.length} UCDBs)` }, () => questa.run(bin, 'vcover', ['merge', outU, ...files], path.dirname(files[0])));
    out.append(r.out);
    if (!fs.existsSync(outU)) { out.show(true); vscode.window.showErrorMessage('vcover merge failed — see output.'); return; }
    return openCoverage(outU);
  }

  function postModel(hist) {
    if (!cov.panel || !cov.model) return;
    cov.panel.webview.postMessage({
      type: 'model', model: cov.model, history: hist || context.workspaceState.get(historyKey(cov.file), []), goal: cfg().get('coverage.goal', 90),
      plan: planEval(), planFile: cov.planFile, regression: cov.regression
    });
  }

  function showPanel() {
    if (cov.panel) { cov.panel.reveal(undefined, true); return; }
    const panel = vscode.window.createWebviewPanel('tenxDebug.coverage', '10xEngineers EDA Coverage', vscode.ViewColumn.Active, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    });
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'activity.svg');
    const n = nonce();
    const u = f => panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', f));
    panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(panel.webview, n)}">
<link rel="stylesheet" href="${u('coverage.css')}"><title>10xEngineers EDA Coverage</title></head><body>
<header><h1>10xEngineers EDA Coverage</h1><span class="src" id="src"></span><span class="grow"></span>
<label style="color:var(--muted)">Goal % <input type="text" id="goal" style="width:42px" value="90"></label>
<button id="bOpen" title="Open another report / UCDB (select several UCDBs to merge)">Open…</button>
<button id="bReload" title="Reload from disk">Reload</button>
<button id="bPlan" title="Load a testplan (.testplan YAML or vplan CSV)">Testplan…</button>
<button id="bHits" title="Excel workbook with only HIT items (bins + testplan items)">Excel: Hit</button>
<button id="bHoles" title="Excel workbook with only UNHIT items (holes, remaining testplan items, uncovered code)">Excel: Unhit</button>
<button id="bExcel" class="primary" title="Full workbook: Summary, Verification Plan, Regression, Hit bins, Unhit bins, Coverpoints, Code, Assertions">Export Excel</button></header>
<nav id="tabs"></nav><main><div class="sheet" id="sheet"><div class="empty">Loading…</div></div></main>
<script nonce="${n}" src="${u('coverage.js')}"></script></body></html>`;
    panel.webview.onDidReceiveMessage(async m => {
      switch (m.type) {
        case 'ready': postModel(); break;
        case 'reload': if (cov.file) openCoverage(cov.file); break;
        case 'openOther': openCoverage(); break;
        case 'goal': await cfg().update('coverage.goal', m.goal, vscode.ConfigurationTarget.Workspace).then(undefined, () => cfg().update('coverage.goal', m.goal, vscode.ConfigurationTarget.Global)); break;
        case 'copy': await vscode.env.clipboard.writeText(m.text); vscode.window.setStatusBarMessage('Copied', 2000); break;
        case 'highlight': cov.highlight = true; applyDecorations(); vscode.window.showInformationMessage('Coverage highlighting on: red = never executed, green = covered. Toggle with "10xEngineers EDA: Toggle Coverage Highlighting".'); break;
        case 'open': {
          const p = await resolveSource(m.file);
          if (!p) { vscode.window.showWarningMessage('Source not found in workspace: ' + m.file); break; }
          await revealLine(vscode.Uri.file(p).toString(), Math.max(0, (m.line || 1) - 1));
          break;
        }
        case 'saveCsv': {
          const def = vscode.Uri.file(path.join(path.dirname(cov.file || '.'), `coverage_${m.name}.csv`));
          const uri = await vscode.window.showSaveDialog({ defaultUri: def, filters: { CSV: ['csv'] } });
          if (uri) { await vscode.workspace.fs.writeFile(uri, Buffer.from('\ufeff' + m.text, 'utf8')); vscode.window.showInformationMessage('Saved ' + path.basename(uri.fsPath)); }
          break;
        }
        case 'excel': {
          if (!cov.model) break;
          const kind = m.kind || 'full';
          const base = path.basename(cov.file || 'coverage').replace(/\.[^.]+$/, '');
          const suffix = { full: '_coverage', hits: '_HIT', holes: '_UNHIT' }[kind];
          const def = vscode.Uri.file(path.join(path.dirname(cov.file || '.'), base + suffix + '.xlsx'));
          const uri = await vscode.window.showSaveDialog({ defaultUri: def, filters: { 'Excel workbook': ['xlsx'] } });
          if (uri) {
            const buf = coverage.toXlsx(cov.model, kind, { goal: cfg().get('coverage.goal', 90), planEval: planEval(), regression: cov.regression });
            await vscode.workspace.fs.writeFile(uri, buf);
            const names = coverage.workbookSheets(cov.model, kind, { planEval: planEval(), regression: cov.regression }).map(s => s.name).join(', ');
            const a = await vscode.window.showInformationMessage(`Saved ${path.basename(uri.fsPath)} — sheets: ${names}`, 'Open');
            if (a) vscode.env.openExternal(uri);
          }
          break;
        }
        case 'loadPlan': loadPlanCmd(); break;
        case 'openLog': if (m.file && fs.existsSync(m.file)) vscode.window.showTextDocument(vscode.Uri.file(m.file)); break;
        case 'openDir': if (m.dir) vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(m.dir)); break;
      }
    });
    panel.onDidDispose(() => { cov.panel = null; });
    cov.panel = panel;
  }

  // reload when the report changes on disk
  const repWatch = vscode.workspace.createFileSystemWatcher('**/*.{txt,rpt,info,dat,json}', true, false, true);
  sub(repWatch);
  let repT;
  sub(repWatch.onDidChange(u => { if (cov.file && path.resolve(u.fsPath) === path.resolve(cov.file)) { clearTimeout(repT); repT = setTimeout(() => openCoverage(cov.file), 800); } }));

  /* ================================================================ Questa */
  async function configureQuesta() {
    const det = questa.detect();
    const items = det.map(d => ({ label: d, description: 'detected', d }));
    items.push({ label: '$(folder) Browse for the Questa/ModelSim install or bin folder…', browse: true });
    items.push({ label: '$(edit) Type a path…', type: true });
    const cur = cfg().get('questa.path', '');
    const pick = await vscode.window.showQuickPick(items, { placeHolder: cur ? 'Current: ' + cur : 'Select the Questa / ModelSim bin directory (contains vsim / vsim.exe)' });
    if (!pick) return null;
    let p = pick.d;
    if (pick.browse) {
      const f = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Use this folder' });
      if (!f) return null;
      p = f[0].fsPath;
    }
    if (pick.type) {
      p = await vscode.window.showInputBox({ prompt: 'Path to Questa install root or bin folder', value: cur || (questa.IS_WIN ? 'C:\\questasim64_2024.1\\win64' : '/opt/questasim/linux_x86_64') });
      if (!p) return null;
    }
    const bin = questa.normalize(p);
    if (!bin) { vscode.window.showErrorMessage(`No vsim executable found under ${p}`); return null; }
    await cfg().update('questa.path', bin, vscode.ConfigurationTarget.Global);
    const v = await questa.version(bin);
    vscode.window.showInformationMessage(`Questa set to ${bin}${v ? ' — ' + v : ''}`);
    return bin;
  }

  async function findTests(dir) {
    const tests = new Set();
    for (const f of fs.readdirSync(dir).filter(x => /\.(sv|svh)$/i.test(x))) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      const re = /\bclass\s+(\w+)\s+extends\s+(\w+)/g;
      let m;
      while ((m = re.exec(t))) if (/test/i.test(m[2]) || /_test$/i.test(m[1])) tests.add(m[1]);
    }
    return [...tests];
  }

  async function runQuesta(uri) {
    const bin = await questaBin(true);
    if (!bin) return;
    let dir;
    if (uri instanceof vscode.Uri) dir = fs.statSync(uri.fsPath).isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
    else {
      const dos = await vscode.workspace.findFiles('**/run.do', '**/node_modules/**', 50);
      if (!dos.length) {
        vscode.window.showWarningMessage('No run.do found. Generate an environment with "10xEngineers EDA: Generate UVM Environment" or add a run.do next to your files.f.');
        return;
      }
      const p = dos.length === 1 ? { d: path.dirname(dos[0].fsPath) } : await vscode.window.showQuickPick(dos.map(u => ({ label: vscode.workspace.asRelativePath(path.dirname(u.fsPath)), d: path.dirname(u.fsPath) })), { placeHolder: 'Testbench folder' });
      if (!p) return;
      dir = p.d;
    }
    if (!fs.existsSync(path.join(dir, 'run.do'))) { vscode.window.showErrorMessage('run.do not found in ' + dir); return; }
    const tests = await findTests(dir);
    let test = '';
    if (tests.length) {
      const t = await vscode.window.showQuickPick(tests, { placeHolder: 'UVM test to run (+UVM_TESTNAME)' });
      if (t === undefined) return;
      test = t;
    } else {
      const t = await vscode.window.showInputBox({ prompt: 'Test name passed to run.do (leave empty for the run.do default)' });
      if (t === undefined) return;
      test = t.trim();
    }
    const mode = await vscode.window.showQuickPick([{ label: 'Batch', description: 'run, save coverage, open dashboard', v: 'batch' }, { label: 'GUI', description: 'open the Questa GUI with waves', v: 'gui' }], { placeHolder: 'Run mode' });
    if (!mode) return;
    const vsim = questa.binPath(bin, 'vsim');
    const doCmd = test ? `do run.do ${test} ${mode.v}` : 'do run.do';
    const args = mode.v === 'gui' ? ['-do', doCmd] : ['-c', '-do', doCmd];
    const ws = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dir)) || (vscode.workspace.workspaceFolders || [])[0];
    const task = new vscode.Task({ type: 'tenxDebug', task: 'questa', test }, ws || vscode.TaskScope.Workspace, `Questa ${test || 'sim'}`, '10xEngineers EDA', new vscode.ProcessExecution(vsim, args, { cwd: dir }), []);
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };
    const started = Date.now();
    const exec = await vscode.tasks.executeTask(task);
    if (mode.v === 'gui') return;
    const d = vscode.tasks.onDidEndTaskProcess(async e => {
      if (e.execution !== exec) return;
      d.dispose();
      const ucdbs = fs.readdirSync(dir).filter(f => /\.ucdb$/i.test(f)).map(f => path.join(dir, f)).filter(f => fs.statSync(f).mtimeMs >= started - 1000);
      if (!ucdbs.length) { vscode.window.showWarningMessage(`Simulation finished (exit ${e.exitCode}) but no new .ucdb was written. Check the task terminal.`); return; }
      const want = ucdbs.find(f => test && path.basename(f).includes(test)) || ucdbs[0];
      if (cfg().get('coverage.openAfterRun', true)) openCoverage(want);
      const vcd = path.join(dir, 'waves.vcd');
      if (fs.existsSync(vcd)) {
        const a = await vscode.window.showInformationMessage(`Simulation done (exit ${e.exitCode}). Waveform written.`, 'Open Waves');
        if (a) vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(vcd), 'tenxDebug.waveform');
      }
    });
    sub(d);
  }

  /* ================================================================ UVM wizard */
  async function uvmWizard(uri) {
    const wsf = vscode.workspace.workspaceFolders;
    if (!wsf) { vscode.window.showWarningMessage('Open a folder first.'); return; }
    const root = wsf[0].uri.fsPath;

    // 1) DUT
    let dutFile = uri instanceof vscode.Uri ? uri.fsPath : null;
    const ed = vscode.window.activeTextEditor;
    if (!dutFile && ed && /\.(s?v|vh|svh)$/i.test(ed.document.fileName) && hdl.parseModules(ed.document.getText()).length) dutFile = ed.document.fileName;
    const srcPick = await vscode.window.showQuickPick([
      ...(dutFile ? [{ label: `$(file-code) Use DUT from ${path.basename(dutFile)}`, v: 'cur' }] : []),
      { label: '$(folder-opened) Pick a DUT file…', v: 'pick' },
      { label: '$(symbol-class) No DUT — valid/ready template', v: 'none' }
    ], { placeHolder: 'UVM Generator · step 1/6 · Design under test', ignoreFocusOut: true });
    if (!srcPick) return;
    let dut = null;
    if (srcPick.v === 'pick') {
      const f = await vscode.window.showOpenDialog({ filters: { 'Verilog/SystemVerilog': ['sv', 'v', 'svh', 'vh'] }, openLabel: 'Use as DUT' });
      if (!f) return;
      dutFile = f[0].fsPath;
    }
    if (srcPick.v !== 'none') {
      const mods = hdl.parseModules(fs.readFileSync(dutFile, 'utf8'));
      if (!mods.length) { vscode.window.showErrorMessage('No module found in ' + path.basename(dutFile)); return; }
      dut = mods.length === 1 ? mods[0] : (await vscode.window.showQuickPick(mods.map(m => ({ label: m.name, description: `${m.ports.length} ports`, m })), { placeHolder: 'Which module is the DUT?', ignoreFocusOut: true }) || {}).m;
      if (!dut) return;
      if (!dut.ports.length) { vscode.window.showErrorMessage(`Module ${dut.name} has no ports that 10xEngineers EDA could parse.`); return; }
    }

    // 2) name
    const name = await vscode.window.showInputBox({
      prompt: 'UVM Generator · step 2/6 · Agent / environment prefix', value: dut ? dut.name.replace(/^(dut_|top_)/, '') : 'my',
      ignoreFocusOut: true,
      validateInput: v => !/^[A-Za-z_]\w*$/.test(v) ? 'Must be a valid SystemVerilog identifier' : /^(module|class|package|interface|uvm)$/.test(v) ? 'Reserved word' : (dut && v === dut.name ? 'Use a prefix different from the DUT module name (e.g. ' + v + '_tb)' : null)
    });
    if (!name) return;

    // 3) agent mode
    const mode = await vscode.window.showQuickPick([{ label: 'Active agent', description: 'driver + sequencer + monitor', v: true }, { label: 'Passive agent', description: 'monitor only (+ coverage / scoreboard)', v: false }], { placeHolder: 'UVM Generator · step 3/6 · Default agent mode (switchable at run time with +PASSIVE)', ignoreFocusOut: true });
    if (!mode) return;

    // 4) features
    const feats = await vscode.window.showQuickPick([
      { label: 'Functional coverage', description: 'covergroup per port + cross', k: 'coverage', picked: true },
      { label: 'Scoreboard', description: 'with reference-model predict() hook', k: 'scoreboard', picked: true },
      { label: 'SVA assertions', description: 'bound into the DUT', k: 'assertions', picked: !!dut },
      { label: 'Questa scripts', description: 'run.do, Makefile, run.sh, run.bat', k: 'questa', picked: true }
    ], { canPickMany: true, placeHolder: 'UVM Generator · step 4/6 · Components', ignoreFocusOut: true });
    if (!feats) return;
    const features = {};
    feats.forEach(f => { features[f.k] = true; });

    // 5) output dir
    const rel = await vscode.window.showInputBox({ prompt: 'UVM Generator · step 5/6 · Output folder (relative to workspace)', value: `verif/${name}_uvm`, ignoreFocusOut: true, validateInput: v => v.trim() ? null : 'Required' });
    if (!rel) return;
    const outDir = path.resolve(root, rel);

    // 6) source list
    const rtl = [];
    if (dutFile) rtl.push(path.relative(outDir, dutFile));
    const more = await vscode.window.showQuickPick([{ label: 'No, continue', v: false }, { label: 'Add more RTL files to files.f…', v: true }], { placeHolder: 'UVM Generator · step 6/6 · Source list (files.f)', ignoreFocusOut: true });
    if (!more) return;
    if (more.v) {
      const fsel = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { 'HDL': ['sv', 'v', 'svh', 'vh', 'f'] }, openLabel: 'Add to source list' });
      (fsel || []).forEach(u => { const r = path.relative(outDir, u.fsPath); if (!rtl.includes(r)) rtl.push(r.toLowerCase().endsWith('.f') ? '-f ' + r : r); });
    }

    const res = uvmgen.generate({ name, dut, active: mode.v, features, clkPeriod: 10, rtlFiles: rtl });
    let existing = Object.keys(res.files).filter(f => fs.existsSync(path.join(outDir, f)));
    let overwrite = false;
    if (existing.length) {
      const a = await vscode.window.showWarningMessage(`${existing.length} file(s) already exist in ${rel}.`, { modal: true }, 'Overwrite', 'Keep existing');
      if (!a) return;
      overwrite = a === 'Overwrite';
    }
    fs.mkdirSync(outDir, { recursive: true });
    let written = 0;
    for (const [f, content] of Object.entries(res.files)) {
      const p = path.join(outDir, f);
      if (fs.existsSync(p) && !overwrite) continue;
      fs.writeFileSync(p, content, 'utf8');
      if (f === 'run.sh') { try { fs.chmodSync(p, 0o755); } catch (e) { /* windows */ } }
      written++;
    }
    out.appendLine(`[UVM] Generated ${written} file(s) in ${outDir}`);
    out.appendLine(`[UVM] clk=${res.summary.clk} rst=${res.summary.rst} (active-${res.summary.activeLow ? 'low' : 'high'}) inputs=[${res.summary.inputs.join(', ')}] outputs=[${res.summary.outputs.join(', ')}] handshake=${res.summary.handshake}`);
    res.warnings.forEach(w => out.appendLine('[UVM] ⚠ ' + w));
    const doc = await vscode.workspace.openTextDocument(path.join(outDir, `${name}_tests.sv`));
    await vscode.window.showTextDocument(doc);
    const actions = features.questa ? ['Run in Questa', 'Show details'] : ['Show details'];
    const a = await vscode.window.showInformationMessage(`UVM environment '${name}' generated (${written} files)${res.warnings.length ? ` with ${res.warnings.length} warning(s)` : ''}.`, ...actions);
    if (a === 'Show details') out.show(true);
    if (a === 'Run in Questa') runQuesta(vscode.Uri.file(outDir));
  }

  /* ================================================================ source list (.f) */
  const flistDiag = vscode.languages.createDiagnosticCollection('10x-filelist');
  sub(flistDiag);

  function validateFilelist(file) {
    const text = fs.readFileSync(file, 'utf8');
    const dir = path.dirname(file);
    const diags = [];
    const lines = text.split(/\r?\n/);
    const expand = s => s.replace(/\$\{?(\w+)\}?/g, (m, v) => process.env[v] || m);
    lines.forEach((ln, i) => {
      const t = ln.replace(/\/\/.*$|#.*$/, '').trim();
      if (!t) return;
      const toks = t.match(/(?:-f|-F|-v|-y)\s+\S+|\+incdir\+\S+|\S+/g) || [];
      toks.forEach(tok => {
        let p = null, isDir = false;
        let m;
        if ((m = /^\+incdir\+(.+)$/.exec(tok))) { m[1].split('+').filter(Boolean).forEach(d => check(d, true)); return; }
        if ((m = /^-(?:f|F|v)\s+(.+)$/.exec(tok))) p = m[1];
        else if ((m = /^-y\s+(.+)$/.exec(tok))) { p = m[1]; isDir = true; }
        else if (/^[+-]/.test(tok)) return;
        else p = tok;
        check(p, isDir);
      });
      function check(p, isDir) {
        const e = expand(p);
        if (/\$/.test(e)) return;
        const abs = path.isAbsolute(e) ? e : path.resolve(dir, e);
        let ok = false;
        try { const st = fs.statSync(abs); ok = isDir ? st.isDirectory() : st.isFile(); } catch (err) { ok = false; }
        if (!ok) {
          const col = Math.max(0, ln.indexOf(p));
          diags.push(new vscode.Diagnostic(new vscode.Range(i, col, i, col + p.length), `${isDir ? 'Directory' : 'File'} not found: ${abs}`, vscode.DiagnosticSeverity.Error));
        }
      }
    });
    flistDiag.set(vscode.Uri.file(file), diags.map(d => { d.source = '10x source list'; return d; }));
    return diags.length;
  }
  sub(vscode.workspace.onDidSaveTextDocument(d => { if (/\.f$/i.test(d.fileName)) validateFilelist(d.fileName); }));
  sub(vscode.workspace.onDidOpenTextDocument(d => { if (/\.f$/i.test(d.fileName) && d.uri.scheme === 'file') validateFilelist(d.fileName); }));

  async function pickFilelist() {
    const ed = vscode.window.activeTextEditor;
    if (ed && /\.f$/i.test(ed.document.fileName)) return ed.document.fileName;
    const fl = await vscode.workspace.findFiles('**/*.f', '**/node_modules/**', 100);
    if (!fl.length) { vscode.window.showWarningMessage('No .f source list found in the workspace.'); return null; }
    if (fl.length === 1) return fl[0].fsPath;
    const p = await vscode.window.showQuickPick(fl.map(u => ({ label: vscode.workspace.asRelativePath(u), p: u.fsPath })), { placeHolder: 'Source list (.f)' });
    return p && p.p;
  }

  async function addToFilelist(uri, uris) {
    let files = (uris && uris.length ? uris : uri instanceof vscode.Uri ? [uri] : []).map(u => u.fsPath);
    if (!files.length) {
      const f = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { 'HDL': ['sv', 'v', 'svh', 'vh', 'f'] }, openLabel: 'Add to source list' });
      if (!f) return;
      files = f.map(u => u.fsPath);
    }
    const fl = await pickFilelist();
    if (!fl) return;
    const dir = path.dirname(fl);
    let text = fs.readFileSync(fl, 'utf8');
    const present = new Set(text.split(/\r?\n/).map(l => l.trim().replace(/\\/g, '/')));
    const added = [];
    for (const f of files) {
      const r = path.relative(dir, f).replace(/\\/g, '/');
      const line = /\.f$/i.test(f) ? '-f ' + r : r;
      if (present.has(line)) continue;
      added.push(line);
      present.add(line);
    }
    if (!added.length) { vscode.window.showInformationMessage('All files are already in ' + path.basename(fl)); return; }
    // insert RTL before the verification block when the generator layout is present
    const marker = text.indexOf('// ---- verification');
    if (marker >= 0) text = text.slice(0, marker) + added.join('\n') + '\n' + text.slice(marker);
    else text = text.replace(/\s*$/, '\n') + added.join('\n') + '\n';
    fs.writeFileSync(fl, text, 'utf8');
    const bad = validateFilelist(fl);
    vscode.window.showInformationMessage(`Added ${added.length} file(s) to ${path.basename(fl)}${bad ? ` — ${bad} missing path(s) flagged` : ''}.`);
  }

  /* ================================================================ testplan commands */
  async function loadPlanCmd() {
    const f = await vscode.window.showOpenDialog({ filters: { 'Testplan': ['testplan', 'yaml', 'yml', 'csv'] }, openLabel: 'Load testplan' });
    if (f) loadPlan(f[0].fsPath);
  }

  async function specToTestplan(uri) {
    let file = uri instanceof vscode.Uri ? uri.fsPath : null;
    if (!file) {
      const ed = vscode.window.activeTextEditor;
      if (ed && /\.(md|txt|rst|adoc)$/i.test(ed.document.fileName)) file = ed.document.fileName;
      else {
        const f = await vscode.window.showOpenDialog({ filters: { 'Specification (text/markdown)': ['md', 'txt', 'rst', 'adoc'] }, openLabel: 'Extract features' });
        if (!f) return;
        file = f[0].fsPath;
      }
    }
    const feats = vplan.extractFromSpec(fs.readFileSync(file, 'utf8'));
    if (!feats.length) { vscode.window.showWarningMessage('No requirement sentences (shall / must / should) found in ' + path.basename(file)); return; }
    const name = path.basename(file).replace(/\.[^.]+$/, '');
    const out = path.join(path.dirname(file), name + '.testplan');
    if (fs.existsSync(out)) {
      const a = await vscode.window.showWarningMessage(`${path.basename(out)} exists.`, { modal: true }, 'Overwrite');
      if (a !== 'Overwrite') return;
    }
    fs.writeFileSync(out, vplan.toTestplanYaml(name, feats), 'utf8');
    const xlsxOut = out.replace(/\.testplan$/, '_testplan.xlsx');
    fs.writeFileSync(xlsxOut, require('./xlsx').build([{
      name: 'Testplan', title: `Testplan: ${name}`, subtitle: `Extracted from ${path.basename(file)} — fill in "Coverage Items" and "Tests"`,
      columns: [{ header: 'ID', width: 16 }, { header: 'Feature', width: 40 }, { header: 'Description', width: 70 }, { header: 'Priority' }, { header: 'Owner' }, { header: 'Coverage Items', width: 40 }, { header: 'Tests', width: 30 }, { header: 'Goal', type: 'num' }],
      rows: feats.map(f => [f.id, f.feature, f.description, f.priority, '', '', '', 100])
    }]));
    await vscode.window.showTextDocument(vscode.Uri.file(out));
    vscode.window.showInformationMessage(`Extracted ${feats.length} feature(s) → ${path.basename(out)} and ${path.basename(xlsxOut)}. Map each feature to coverpoints / assertions / tests, then load it in the coverage dashboard.`);
  }

  /* ================================================================ regression */
  function parseTranscript(text) {
    const cnt = k => { const m = new RegExp('^#?\\s*' + k + '\\s*:\\s*(\\d+)', 'm').exec(text); return m ? +m[1] : 0; };
    const errors = cnt('UVM_ERROR'), fatals = cnt('UVM_FATAL'), warnings = cnt('UVM_WARNING');
    const passed = /TEST PASSED/.test(text);
    const failedTxt = /TEST FAILED/.test(text);
    const toolErr = /\*\* (Error|Fatal)[:(]/.test(text) || /Error loading design/.test(text);
    let status = 'PASS';
    if (toolErr) status = /License/i.test(text) ? 'NO LICENSE' : 'ERROR';
    else if (errors || fatals || failedTxt) status = 'FAIL';
    else if (!passed && !/UVM Report Summary|\$finish/.test(text)) status = 'ERROR';
    return { errors, fatals, warnings, status };
  }

  function execP(file, args, opts) {
    return new Promise(res => {
      const p = cp.execFile(file, args, Object.assign({ windowsHide: true, maxBuffer: 256 * 1024 * 1024 }, opts), (err, so, se) => res({ err, out: (so || '') + (se || '') }));
      if (opts && opts.token) opts.token.onCancellationRequested(() => { try { p.kill(); } catch (e) { /* ignore */ } });
    });
  }

  async function runRegression(uri) {
    let rfile = uri instanceof vscode.Uri && /\.json$/i.test(uri.fsPath) ? uri.fsPath : null;
    if (!rfile) {
      const found = await vscode.workspace.findFiles('**/regression*.json', '**/{node_modules,.git,regression_runs}/**', 20);
      if (!found.length) { vscode.window.showWarningMessage('No regression.json found. Generate a UVM environment or see README → Regression.'); return; }
      const p = found.length === 1 ? found[0] : (await vscode.window.showQuickPick(found.map(u => ({ label: vscode.workspace.asRelativePath(u), u })), { placeHolder: 'Regression file' }) || {}).u;
      if (!p) return;
      rfile = p.fsPath;
    }
    const spec = JSON.parse(fs.readFileSync(rfile, 'utf8'));
    const bin = await questaBin(true);
    if (!bin) return;
    const root = path.dirname(rfile);
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..*$/, '');
    const outRoot = path.resolve(root, spec.output || 'regression_runs', stamp);
    fs.mkdirSync(outRoot, { recursive: true });
    const runs = [];
    for (const job of spec.jobs || []) {
      for (const t of job.tests || []) {
        const test = typeof t === 'string' ? t : t.name;
        const seedSpec = (typeof t === 'object' && t.seeds) || job.seeds || spec.seeds || 1;
        const seeds = Array.isArray(seedSpec) ? seedSpec : Array.from({ length: seedSpec }, () => 1 + Math.floor(Math.random() * 2147483646));
        for (const seed of seeds) runs.push({ job: job.name, jobDir: path.resolve(root, job.dir), test, seed, dir: path.join(outRoot, job.name, test, 'seed_' + seed) });
      }
    }
    if (!runs.length) { vscode.window.showWarningMessage('regression.json has no tests.'); return; }
    const vsim = questa.binPath(bin, 'vsim');
    out.show(true);
    out.appendLine(`\n=== Regression ${spec.name || ''}: ${runs.length} run(s) → ${outRoot}`);
    const result = { name: spec.name || path.basename(root), started: new Date().toISOString(), outRoot, runs: [] };
    const cancelled = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Regression', cancellable: true }, async (prog, token) => {
      // 1) compile each job once
      for (const job of [...new Set(runs.map(r => r.jobDir))]) {
        if (token.isCancellationRequested) return true;
        prog.report({ message: 'compiling ' + path.basename(job) });
        const r = await execP(vsim, ['-c', '-do', 'do run.do "" compile'], { cwd: job, env: simEnv(), token });
        fs.writeFileSync(path.join(outRoot, path.basename(job) + '_compile.log'), r.out);
        const bad = /Errors: [1-9]/.test(r.out);
        out.appendLine(`[compile] ${path.basename(job)}: ${bad ? 'ERRORS — see ' + path.basename(job) + '_compile.log' : 'ok'}`);
        if (bad) runs.filter(x => x.jobDir === job).forEach(x => { x.skip = 'COMPILE ERROR'; });
      }
      // 2) run every test/seed in its own directory
      const par = Math.max(1, spec.parallel || cfg().get('regression.parallel', 2));
      let next = 0, done = 0;
      const worker = async () => {
        while (next < runs.length && !token.isCancellationRequested) {
          const r = runs[next++];
          fs.mkdirSync(r.dir, { recursive: true });
          const t0 = Date.now();
          let rec;
          if (r.skip) rec = { status: r.skip, errors: 0, fatals: 0, warnings: 0 };
          else {
            const ucdb = path.join(r.dir, 'cov.ucdb');
            const res = await execP(vsim, ['-c', '-do', `do {${r.jobDir.replace(/\\/g, '/')}/run.do} ${r.test} batch`], {
              cwd: r.dir, token, env: simEnv({ SEED: String(r.seed), NOCOMPILE: '1', WORKLIB: path.join(r.jobDir, 'work').replace(/\\/g, '/'), UCDB: ucdb.replace(/\\/g, '/') })
            });
            fs.writeFileSync(path.join(r.dir, 'transcript.log'), res.out);
            rec = parseTranscript(res.out);
            if (fs.existsSync(ucdb)) r.ucdb = ucdb;
          }
          const row = { job: r.job, test: r.test, seed: r.seed, dir: r.dir, log: path.join(r.dir, 'transcript.log'), time: Math.round((Date.now() - t0) / 100) / 10, ucdb: r.ucdb || null, ...rec };
          result.runs.push(row);
          done++;
          out.appendLine(`[${done}/${runs.length}] ${row.status.padEnd(10)} ${r.job}/${r.test} seed=${r.seed}  (${row.time}s)  ${row.errors ? row.errors + ' UVM_ERROR ' : ''}${row.fatals ? row.fatals + ' UVM_FATAL' : ''}`);
          prog.report({ message: `${done}/${runs.length} · ${r.test}`, increment: 100 / runs.length });
        }
      };
      await Promise.all(Array.from({ length: par }, worker));
      return token.isCancellationRequested;
    });
    result.finished = new Date().toISOString();
    result.runs.sort((a, b) => (a.job + a.test).localeCompare(b.job + b.test) || a.seed - b.seed);
    fs.writeFileSync(path.join(outRoot, 'results.json'), JSON.stringify(result, null, 2));
    const pass = result.runs.filter(r => r.status === 'PASS').length;
    out.appendLine(`=== ${pass}/${result.runs.length} passed${cancelled ? ' (cancelled)' : ''}`);
    if (result.runs.some(r => r.status === 'NO LICENSE')) vscode.window.showErrorMessage('Questa could not check out a simulation license (see a transcript.log). Fix the license (MGLS_LICENSE_FILE / LM_LICENSE_FILE) and run again.');
    cov.regression = result;
    // 3) merge coverage and open the dashboard
    const ucdbs = result.runs.map(r => r.ucdb).filter(Boolean);
    if (spec.testplan) await loadPlan(path.resolve(root, spec.testplan), true);
    if (ucdbs.length) {
      const merged = path.join(outRoot, 'merged.ucdb');
      const mr = await questa.run(bin, 'vcover', ['merge', merged, ...ucdbs], outRoot);
      out.append(mr.out);
      if (fs.existsSync(merged)) return openCoverage(merged);
    }
    vscode.window.showWarningMessage(`Regression finished: ${pass}/${result.runs.length} passed, no coverage database produced.`);
    if (cov.model) postModel();
  }

  /* ================================================================ coverage tree: reports, hierarchy, testplan */
  const sevIcon = p => new vscode.ThemeIcon(p >= cfg().get('coverage.goal', 90) ? 'pass-filled' : p > 0 ? 'warning' : 'error',
    new vscode.ThemeColor(p >= cfg().get('coverage.goal', 90) ? 'testing.iconPassed' : p > 0 ? 'list.warningForeground' : 'testing.iconFailed'));
  class CovTree {
    constructor() { this._em = new vscode.EventEmitter(); this.onDidChangeTreeData = this._em.event; }
    refresh() { this._em.fire(); }
    getTreeItem(e) { return e; }
    async getChildren(el) {
      const T = vscode.TreeItemCollapsibleState;
      if (!el) {
        const roots = [];
        if (cov.model) {
          const h = new vscode.TreeItem('Coverage hierarchy', T.Expanded); h._k = 'hier'; h.description = cov.model.total != null ? cov.model.total.toFixed(2) + '%' : ''; h.iconPath = new vscode.ThemeIcon('type-hierarchy'); roots.push(h);
          if (cov.plan) { const p = new vscode.TreeItem('Testplan', T.Expanded); p._k = 'plan'; p.description = path.basename(cov.planFile); p.iconPath = new vscode.ThemeIcon('checklist'); roots.push(p); }
          if (cov.regression) { const r = new vscode.TreeItem('Regression', T.Collapsed); r._k = 'reg'; const ps = cov.regression.runs.filter(x => x.status === 'PASS').length; r.description = `${ps}/${cov.regression.runs.length} passed`; r.iconPath = new vscode.ThemeIcon('beaker'); roots.push(r); }
        }
        const f = new vscode.TreeItem('Reports in workspace', cov.model ? T.Collapsed : T.Expanded); f._k = 'files'; f.iconPath = new vscode.ThemeIcon('files'); roots.push(f);
        return roots;
      }
      if (el._k === 'files') {
        const found = await vscode.workspace.findFiles('**/{*.ucdb,*cov*.txt,*coverage*.rpt,*.info,coverage.dat,*coverage*.json,*.testplan}', '**/{node_modules,.git}/**', 300);
        return found.sort((a, b) => a.fsPath.localeCompare(b.fsPath)).map(u => {
          const it = new vscode.TreeItem(path.basename(u.fsPath));
          it.resourceUri = u;
          it.description = vscode.workspace.asRelativePath(path.dirname(u.fsPath));
          it.iconPath = new vscode.ThemeIcon(/\.ucdb$/i.test(u.fsPath) ? 'database' : /\.testplan$/i.test(u.fsPath) ? 'checklist' : 'graph');
          it.command = /\.testplan$/i.test(u.fsPath) ? { command: 'tenxDebug.loadTestplan', title: 'Load', arguments: [u] } : { command: 'tenxDebug.openCoverage', title: 'Open', arguments: [u] };
          return it;
        });
      }
      if (el._k === 'hier') {
        const items = [];
        const code = new vscode.TreeItem('Code coverage', T.Collapsed); code._k = 'code'; code.iconPath = new vscode.ThemeIcon('code'); items.push(code);
        const types = cov.model.covergroups.filter(c => c.kind === 'type');
        (types.length ? types : cov.model.covergroups).forEach(cg => {
          const it = new vscode.TreeItem(cg.name.split('/').pop(), T.Collapsed); it._cg = cg; it.description = cg.pct.toFixed(2) + '%'; it.iconPath = sevIcon(cg.pct); it.tooltip = cg.name; items.push(it);
        });
        if (cov.model.assertions.length || cov.model.directives.length) { const a = new vscode.TreeItem('Assertions & cover directives', T.Collapsed); a._k = 'asrt'; a.iconPath = new vscode.ThemeIcon('shield'); items.push(a); }
        return items;
      }
      if (el._k === 'code') return cov.model.metrics.filter(m => !/Covergroup|Coverpoints|Assertions|Directives/i.test(m.name)).map(m => { const it = new vscode.TreeItem(m.name); it.description = `${m.pct}%  (${m.hits}/${m.bins})`; it.iconPath = sevIcon(m.pct); return it; });
      if (el._cg) return el._cg.coverpoints.map(c => { const it = new vscode.TreeItem(c.name, c.bins.length ? T.Collapsed : T.None); it._cp = c; it.description = `${c.pct}% · ${c.kind}`; it.iconPath = sevIcon(c.pct); return it; });
      if (el._cp) return el._cp.bins.map(b => { const it = new vscode.TreeItem(b.name); const ok = b.hits >= b.atLeast; it.description = `${b.hits} hit${b.type !== 'bin' ? ' · ' + b.type : ''}`; it.iconPath = b.type !== 'bin' ? new vscode.ThemeIcon('circle-slash') : sevIcon(ok ? 100 : 0); return it; });
      if (el._k === 'asrt') return [...cov.model.assertions.map(a => { const it = new vscode.TreeItem(a.name.split('/').pop()); it.description = a.status; it.iconPath = sevIcon(a.status === 'passed' ? 100 : a.status === 'failed' ? 0 : 50); it.tooltip = a.name; return it; }),
        ...cov.model.directives.map(d => { const it = new vscode.TreeItem(d.name.split('/').pop()); it.description = `cover · ${d.count}`; it.iconPath = sevIcon(d.count ? 100 : 0); return it; })];
      if (el._k === 'plan') return (planEval() || []).map(f => { const it = new vscode.TreeItem(`${f.id}  ${f.feature}`, T.Collapsed); it._f = f; it.description = f.pct == null ? f.status : `${f.pct}% · ${f.status}`; it.iconPath = f.status === 'UNMAPPED' ? new vscode.ThemeIcon('question') : sevIcon(f.pct || 0); it.tooltip = f.description; return it; });
      if (el._f) return [...el._f.hit.map(h => { const it = new vscode.TreeItem(h.label); it.description = 'hit'; it.iconPath = sevIcon(100); return it; }), ...el._f.unhit.map(h => { const it = new vscode.TreeItem(h.label); it.description = 'remaining' + (h.detail ? ' · ' + h.detail : ''); it.iconPath = sevIcon(h.pct > 0 ? 50 : 0); return it; }), ...el._f.missingPatterns.map(p => { const it = new vscode.TreeItem(p); it.description = 'not found in coverage'; it.iconPath = new vscode.ThemeIcon('question'); return it; })];
      if (el._k === 'reg') return cov.regression.runs.map(r => { const it = new vscode.TreeItem(`${r.test}  seed ${r.seed}`); it.description = `${r.status} · ${r.job} · ${r.time}s`; it.iconPath = sevIcon(r.status === 'PASS' ? 100 : 0); it.command = { command: 'vscode.open', title: 'Log', arguments: [vscode.Uri.file(r.log)] }; it.tooltip = r.dir; return it; });
      return [];
    }
  }
  const covTree = new CovTree();
  function covTreeRefresh() { covTree.refresh(); }
  sub(vscode.window.registerTreeDataProvider('tenxDebug.coverageFiles', covTree));

  /* ================================================================ Testing panel (VS Code ≥ 1.88) */
  let testCtrl = null;
  async function publishTestingCoverage() {
    try {
      if (!cov.model || !vscode.tests || !vscode.FileCoverage || !Object.keys(cov.model.code).length) return;
      if (!testCtrl) { testCtrl = vscode.tests.createTestController('tenxDebugCoverage', '10xEngineers EDA Coverage'); sub(testCtrl); }
      const run = testCtrl.createTestRun(new vscode.TestRunRequest(), 'Coverage: ' + path.basename(cov.file), false);
      for (const [f, lines] of Object.entries(cov.model.code)) {
        const p = await resolveSource(f);
        if (!p) continue;
        const uri = vscode.Uri.file(p);
        const details = Object.entries(lines).map(([l, v]) => new vscode.StatementCoverage(v.hits, new vscode.Position(Math.max(0, +l - 1), 0)));
        const fc = vscode.FileCoverage.fromDetails ? vscode.FileCoverage.fromDetails(uri, details) : null;
        if (fc) { run.addCoverage(fc); }
      }
      run.end();
    } catch (e) { /* older VS Code / Cursor without coverage API */ }
  }
  const covWatch = vscode.workspace.createFileSystemWatcher('**/*.{ucdb,info,dat,txt}', false, true, false);
  sub(covWatch);
  sub(covWatch.onDidCreate(() => covTree.refresh()));
  sub(covWatch.onDidDelete(() => covTree.refresh()));

  /* ================================================================ commands */
  sub(vscode.commands.registerCommand('tenxDebug.openCoverage', u => openCoverage(u)));
  sub(vscode.commands.registerCommand('tenxDebug.coverageDashboard', () => cov.model ? (showPanel(), postModel()) : openCoverage()));
  sub(vscode.commands.registerCommand('tenxDebug.toggleCoverageHighlight', () => {
    if (!cov.model) { vscode.window.showWarningMessage('Open a coverage report first.'); return; }
    cov.highlight = !cov.highlight; applyDecorations();
    vscode.window.setStatusBarMessage(`Coverage highlighting ${cov.highlight ? 'on' : 'off'}`, 2500);
  }));
  sub(vscode.commands.registerCommand('tenxDebug.refreshCoverage', () => covTree.refresh()));
  sub(vscode.commands.registerCommand('tenxDebug.loadTestplan', u => u instanceof vscode.Uri ? loadPlan(u.fsPath) : loadPlanCmd()));
  sub(vscode.commands.registerCommand('tenxDebug.runRegression', u => runRegression(u)));
  sub(vscode.commands.registerCommand('tenxDebug.specToTestplan', u => specToTestplan(u)));
  sub(vscode.commands.registerCommand('tenxDebug.configureQuesta', configureQuesta));
  sub(vscode.commands.registerCommand('tenxDebug.runQuesta', u => runQuesta(u)));
  sub(vscode.commands.registerCommand('tenxDebug.newUvmAgent', u => uvmWizard(u)));
  sub(vscode.commands.registerCommand('tenxDebug.addToSourceList', (u, us) => addToFilelist(u, us)));
  sub(vscode.commands.registerCommand('tenxDebug.validateSourceList', async () => {
    const fl = await pickFilelist();
    if (!fl) return;
    const n = validateFilelist(fl);
    vscode.window.showInformationMessage(n ? `${n} missing path(s) in ${path.basename(fl)} — see Problems.` : `${path.basename(fl)}: all paths exist ✓`);
  }));
  sub(vscode.tasks.registerTaskProvider('tenxDebug', { provideTasks: () => [], resolveTask: t => t }));
}

module.exports = { register };

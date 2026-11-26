'use strict';
/*
 * 10xEngineer RTL Regression Explorer — the DV regression in VS Code's Test Explorer.
 *  - dvflow.json suites/tests (and SymbiYosys "formal" entries) appear as TestItems before anything runs
 *  - runs/<id>/results.json and runs/formal.json decorate them (state, duration, inline failure messages)
 *  - formal verdicts are preserved (description, filterable TestTag, message); only a real counterexample
 *    offers "Open Counterexample in 10xEngineers EDA", which opens the VCD beside the failing property
 *  - "dvflow" task type runs the same CLI in a terminal (CI style) and the tree refreshes from its results
 * Also: DV: Configure Simulators / Doctor / Retry Last Run / Select Simulator.
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const runner = require('./runner');
const sim = require('./sim');
const formal = require('./formal');

function register(context, out) {
  const sub = d => context.subscriptions.push(d);
  const ctrl = vscode.tests.createTestController('tenxRtlRegressionExplorer', '10xEngineer RTL Regression Explorer');
  sub(ctrl);
  const TAG = { formal: new vscode.TestTag('formal'), sim: new vscode.TestTag('simulation') };
  const verdictTag = v => new vscode.TestTag('verdict:' + v);
  const projects = new Map();       // root -> {cfg, item}
  const cexItems = new Set();

  async function discover() {
    const found = await vscode.workspace.findFiles('**/dvflow.json', '**/{node_modules,.git,runs,.dvflow}/**', 200);
    const seen = new Set();
    for (const u of found) {
      const root = path.dirname(u.fsPath);
      seen.add(root);
      let cfg;
      try { cfg = runner.loadConfig(root); } catch (e) { continue; }
      const id = 'p:' + root;
      const p = ctrl.createTestItem(id, cfg.name || cfg.dut.top, u);
      p.description = `${cfg.dut.top} · ${cfg.simulator}${(cfg.language || 'sv') === 'vhdl' ? ' · VHDL' : ''}`;
      const children = [];
      for (const [suite, tests] of Object.entries(cfg.suites || { full: cfg.tests })) {
        const s = ctrl.createTestItem(`${id}|s:${suite}`, `suite ${suite}`, u);
        s.tags = [TAG.sim];
        s.children.replace(tests.map(t => {
          const ti = ctrl.createTestItem(`${id}|s:${suite}|t:${t}`, t, u);
          ti.tags = [TAG.sim];
          ti.children.replace(cfg.configs.flatMap(c => cfg.seeds.map(seed => {
            const j = ctrl.createTestItem(`${id}|s:${suite}|t:${t}|c:${c.name}|seed:${seed}`, `${c.name} · seed ${seed}`, u);
            j.tags = [TAG.sim];
            return j;
          })));
          return ti;
        }));
        children.push(s);
      }
      if (cfg.formal && cfg.formal.length) {
        const fs_ = ctrl.createTestItem(`${id}|formal`, 'formal (SymbiYosys)', u);
        fs_.tags = [TAG.formal];
        fs_.children.replace(cfg.formal.map(f => { const it = ctrl.createTestItem(`${id}|formal|${f.name}`, f.name, vscode.Uri.file(path.resolve(root, f.sby))); it.tags = [TAG.formal]; it.description = 'not run'; return it; }));
        children.push(fs_);
      }
      p.children.replace(children);
      ctrl.items.add(p);
      projects.set(root, { cfg, item: p });
    }
    ctrl.items.forEach(it => { if (!seen.has(it.id.slice(2))) ctrl.items.delete(it.id); });
    for (const root of seen) decorate(root);
  }

  function find(id) {
    const parts = id.split('|');
    let item = ctrl.items.get(parts[0]);
    for (let k = 1; item && k < parts.length; k++) item = item.children.get(parts.slice(0, k + 1).join('|'));
    return item;
  }

  /** Show the latest results (also from runs started in a terminal / CI task) without re-running. */
  function decorate(root) {
    const pr = projects.get(root);
    if (!pr) return;
    const latest = path.join(root, 'runs', 'latest.txt');
    const run = ctrl.createTestRun(new vscode.TestRunRequest(), `results of ${pr.cfg.name || pr.cfg.dut.top}`, false);
    if (fs.existsSync(latest)) {
      try {
        const id = fs.readFileSync(latest, 'utf8').trim();
        const res = JSON.parse(fs.readFileSync(path.join(root, 'runs', id, 'results.json'), 'utf8'));
        applyResults(run, root, res);
      } catch (e) { /* partial run */ }
    }
    const fj = path.join(root, 'runs', 'formal.json');
    if (fs.existsSync(fj)) { try { applyFormal(run, root, JSON.parse(fs.readFileSync(fj, 'utf8'))); } catch (e) { /* ignore */ } }
    run.end();
  }

  function message(root, res, r) {
    const text = `${r.status}${r.stage ? ' at stage ' + r.stage : ''}: ${r.firstError || ''}${r.nextAction ? '\nNext: ' + r.nextAction : ''}\nSimulator: ${res.meta.simLabel} ${res.meta.simVersion}`;
    const mm = /^(\S+) expected (\S+) got (\S+)/.exec(r.firstError || '');
    const m = mm ? vscode.TestMessage.diff(text, mm[2], mm[3]) : new vscode.TestMessage(text);
    if (r.failureDir) m.location = new vscode.Location(vscode.Uri.file(path.join(root, 'runs', res.meta.runId, r.failureDir, 'triage.md')), new vscode.Position(0, 0));
    return m;
  }

  function applyResults(run, root, res) {
    const pid = 'p:' + root;
    const pr = projects.get(root);
    for (const r of res.runs) {
      for (const [suite, tests] of Object.entries(pr.cfg.suites || {})) {
        if (!tests.includes(r.test)) continue;
        const it = find(`${pid}|s:${suite}|t:${r.test}|c:${r.config}|seed:${r.seed}`);
        if (!it) continue;
        it.description = `${r.status} · ${res.meta.simulator}${r.time ? ' · ' + r.time + 's' : ''}`;
        const ms = (r.time || 0) * 1000;
        if (r.status === 'PASS') run.passed(it, ms);
        else if (r.status === 'FAIL' || r.status === 'TIMEOUT') run.failed(it, message(root, res, r), ms);
        else if (r.status === 'CANCELLED' || r.status === 'NOT RUN') run.skipped(it);
        else run.errored(it, message(root, res, r), ms);   // LICENSE / ERROR / BLOCKED / INCOMPLETE: no verdict on the design
      }
    }
  }

  function applyFormal(run, root, fj) {
    cexItems.clear();
    for (const r of fj.results) {
      const it = find(`p:${root}|formal|${r.name}`);
      if (!it) continue;
      it.description = `${r.verdict} — ${r.label}`;
      it.tags = [TAG.formal, verdictTag(r.verdict)];
      const ms = (r.duration_s || 0) * 1000;
      const msg = new vscode.TestMessage(`SymbiYosys verdict: ${r.status} (${r.label})${r.property ? `\nproperty: ${r.property.file}:${r.property.line}` : ''}${r.trace ? `\ncounterexample: ${r.trace}` : ''}${r.blocked ? '\nInstall SymbiYosys (sby) and add it to PATH.' : ''}`);
      if (r.property) { const pf = path.resolve(path.dirname(path.resolve(root, r.sby)), r.property.file); if (fs.existsSync(pf)) msg.location = new vscode.Location(vscode.Uri.file(pf), new vscode.Position(r.property.line - 1, r.property.col - 1)); }
      if (r.state === 'passed') run.passed(it, ms);
      else if (r.state === 'failed') { run.failed(it, msg, ms); if (r.trace) cexItems.add(it.id); }
      else run.errored(it, msg, ms);
    }
    vscode.commands.executeCommand('setContext', 'tenxDebug.cexTests', [...cexItems]);
  }

  /* ---------------------------------------------------------------- run profile */
  async function runHandler(request, token) {
    const run = ctrl.createTestRun(request, '10xEngineer RTL Regression', true);
    const include = request.include && request.include.length ? request.include : [...function* () { for (const [, it] of ctrl.items) yield it; }()];
    const byRoot = new Map();
    const leaves = it => (it.children.size ? [...function* () { for (const [, c] of it.children) yield* leaves(c); }()] : [it]);
    for (const it of include) for (const leaf of leaves(it)) {
      const root = leaf.id.split('|')[0].slice(2);
      const e = byRoot.get(root) || { jobs: [], formal: [] };
      const fm = /\|formal\|(.+)$/.exec(leaf.id);
      const jm = /\|t:([^|]+)\|c:([^|]+)\|seed:(-?\d+)$/.exec(leaf.id);
      if (fm) e.formal.push(fm[1]); else if (jm) e.jobs.push({ test: jm[1], config: jm[2], seed: Number(jm[3]) });
      byRoot.set(root, e);
      run.enqueued(leaf);
    }
    for (const [root, e] of byRoot) {
      if (token.isCancellationRequested) break;
      const pr = projects.get(root);
      const log = s => run.appendOutput(s.replace(/\r?\n/g, '\r\n') + '\r\n');
      if (e.jobs.length) {
        if (vscode.workspace.isTrusted === false) { log('Simulations run only in a trusted workspace.'); continue; }
        const uniq = [...new Map(e.jobs.map(j => [`${j.config}/${j.test}/${j.seed}`, j])).values()];
        try {
          const res = await runner.regress(root, { jobs: uniq, configs: [...new Set(uniq.map(j => j.config))], log, token, suite: 'explorer' });
          applyResults(run, root, res);
        } catch (err) { log('dvflow: ' + err.message); }
      }
      if (e.formal.length) {
        const fj = await formal.run(root, pr.cfg, { only: e.formal, log });
        applyFormal(run, root, fj);
      }
    }
    run.end();
  }
  ctrl.createRunProfile('Run', vscode.TestRunProfileKind.Run, runHandler, true);
  ctrl.resolveHandler = async item => { if (!item) await discover(); };
  ctrl.refreshHandler = () => discover();

  /* ---------------------------------------------------------------- counterexample */
  sub(vscode.commands.registerCommand('tenxDebug.openCounterexample', async item => {
    const id = item && item.id;
    const m = id && /^p:(.+)\|formal\|(.+)$/.exec(id);
    if (!m) { vscode.window.showInformationMessage('Select a failing formal property in the 10xEngineer RTL Regression Explorer.'); return; }
    const [, root, name] = m;
    const fj = path.join(root, 'runs', 'formal.json');
    const r = fs.existsSync(fj) ? JSON.parse(fs.readFileSync(fj, 'utf8')).results.find(x => x.name === name) : null;
    if (!r || r.verdict !== 'counterexample') { vscode.window.showInformationMessage(`No counterexample for ${name}: SymbiYosys verdict is ${r ? r.status + ' (' + r.label + ')' : 'not run'}. Only a refuted property has a trace.`); return; }
    const trace = path.resolve(root, r.trace || '');
    if (!r.trace || !fs.existsSync(trace)) { vscode.window.showWarningMessage(`The counterexample trace was recorded on ${r.host} at ${r.trace || '(no path)'} and is not on this machine. Copy the SymbiYosys work directory (${r.workdir}) here, or re-run the property locally.`); return; }
    if (r.property) {
      const pf = path.resolve(path.dirname(path.resolve(root, r.sby)), r.property.file);
      if (fs.existsSync(pf)) await vscode.window.showTextDocument(vscode.Uri.file(pf), { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(r.property.line - 1, 0, r.property.line - 1, 0) });
    }
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(trace), 'tenxDebug.waveform', vscode.ViewColumn.Beside);
  }));

  /* ---------------------------------------------------------------- task type: dvflow */
  sub(vscode.tasks.registerTaskProvider('dvflow', {
    provideTasks() {
      const tasks = [];
      for (const [root, pr] of projects) {
        const wrapper = sim.IS_WIN ? path.join(root, 'dvflow.cmd') : path.join(root, 'dvflow.sh');
        if (!fs.existsSync(wrapper)) continue;
        for (const command of ['regress', 'doctor', 'retry']) {
          const def = { type: 'dvflow', project: path.basename(root), command };
          const t = new vscode.Task(def, vscode.TaskScope.Workspace, `${command} ${pr.cfg.name || pr.cfg.dut.top}`, '10xEngineer RTL Regression', new vscode.ProcessExecution(wrapper, [command, ...(command === 'regress' ? ['--ci', '1'] : [])], { cwd: root }), []);
          t.group = command === 'regress' ? vscode.TaskGroup.Test : undefined;
          tasks.push(t);
        }
      }
      return tasks;
    },
    resolveTask: t => t
  }));
  // refresh the tree whenever any run (task, terminal, CI copy) writes new results
  const w = vscode.workspace.createFileSystemWatcher('**/runs/{latest.txt,formal.json}');
  sub(w);
  const refresh = u => { const root = path.dirname(path.dirname(u.fsPath)); if (projects.has(root)) setTimeout(() => decorate(root), 300); };
  sub(w.onDidChange(refresh)); sub(w.onDidCreate(refresh));
  const wc = vscode.workspace.createFileSystemWatcher('**/dvflow.json');
  sub(wc); sub(wc.onDidChange(() => discover())); sub(wc.onDidCreate(() => discover())); sub(wc.onDidDelete(() => discover()));
  discover();

  /* ---------------------------------------------------------------- simulator setup: configure / doctor / retry / select */
  async function pickProjectRoot() {
    const roots = [...projects.keys()];
    if (roots.length === 1) return roots[0];
    if (!roots.length) { vscode.window.showWarningMessage('No dvflow.json in this workspace.'); return null; }
    const p = await vscode.window.showQuickPick(roots.map(r => ({ label: path.basename(r), description: vscode.workspace.asRelativePath(r), r })), { placeHolder: 'DV project' });
    return p && p.r;
  }
  async function configureSims() {
    const caps = sim.capabilities();
    const pick = await vscode.window.showQuickPick(caps.map(c => ({ label: c.label, description: c.available ? `${c.version} (${c.source})` : 'not found', id: c.id })), { placeHolder: 'Simulator to configure (stored per user in ' + sim.USER_FILE + ', never in the project)' });
    if (!pick) return;
    const u = sim.loadUser();
    const cur = u[pick.id] || {};
    const act = await vscode.window.showQuickPick([
      { label: '$(folder) Set installation or bin folder…', a: 'bin', description: cur.bin || 'PATH' },
      ...(pick.id === 'questa' || pick.id === 'vcs' ? [
        { label: '$(key) Set per-user license file…', a: 'lic' },
        { label: '$(server) Set per-user license server (port@host)…', a: 'srv' },
        { label: '$(discard) Clear license override (inherit the environment)', a: 'clrlic', description: cur.license ? 'override set' : 'inheriting' }] : []),
      { label: '$(discard) Clear folder (use PATH)', a: 'clrbin' },
      { label: '$(pulse) Run doctor', a: 'doctor' }
    ], { placeHolder: `${pick.label}: folder ${cur.bin || '(PATH)'} · license ${cur.license ? 'per-user override' : 'inherited from the environment'}` });
    if (!act) return;
    const licVar = pick.id === 'vcs' ? 'SNPSLMD_LICENSE_FILE' : 'MGLS_LICENSE_FILE';
    if (act.a === 'bin') { const f = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Use this folder' }); if (!f) return; u[pick.id] = Object.assign(cur, { bin: f[0].fsPath }); }
    if (act.a === 'lic') { const f = await vscode.window.showOpenDialog({ canSelectFiles: true, openLabel: 'Use this license file' }); if (!f) return; u[pick.id] = Object.assign(cur, { license: Object.assign(cur.license || {}, { [licVar]: f[0].fsPath }) }); }
    if (act.a === 'srv') { const s = await vscode.window.showInputBox({ prompt: 'License server (port@host)', password: true, ignoreFocusOut: true }); if (!s) return; u[pick.id] = Object.assign(cur, { license: Object.assign(cur.license || {}, { [licVar]: s }) }); }
    if (act.a === 'clrlic') delete cur.license;
    if (act.a === 'clrbin') delete cur.bin;
    if (act.a !== 'doctor') { u[pick.id] = cur; sim.saveUser(u); vscode.window.showInformationMessage(`${pick.label} settings saved for your user account only. The extension, make and the CLI all read them.`); }
    const d = await vscode.window.showInformationMessage(`Run doctor for ${pick.label} now?`, 'Run doctor');
    if (d || act.a === 'doctor') doctorCmd(pick.id);
  }
  async function doctorCmd(simId) {
    if (!simId) { const root = await pickProjectRoot(); simId = root ? runner.loadConfig(root).simulator : 'icarus'; const p = await vscode.window.showQuickPick(Object.keys(sim.ADAPTERS).map(s => ({ label: s, picked: s === simId })), { placeHolder: 'Simulator to check' }); if (!p) return; simId = p.label; }
    const cov = await vscode.window.showQuickPick([{ label: 'Installation + license smoke', v: [0, 0] }, { label: '+ UVM', v: [1, 0] }, { label: '+ coverage', v: [0, 1] }, { label: '+ UVM + coverage', v: [1, 1] }], { placeHolder: 'Checks' });
    if (!cov) return;
    out.show(true);
    out.appendLine(`\n== doctor: ${simId}`);
    const d = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Doctor: ${simId}` }, async () => sim.doctor(simId, { uvm: !!cov.v[0], coverage: !!cov.v[1] }));
    for (const s of d.stages) { out.appendLine(`[${s.ok ? 'PASS' : 'FAIL'}] ${s.stage}`); if (s.detail) out.appendLine(s.detail.split('\n').map(x => '       ' + x).join('\n')); if (!s.ok && s.next) out.appendLine('       NEXT: ' + s.next); }
    const bad = d.stages.find(s => !s.ok);
    if (d.ok) { const a = await vscode.window.showInformationMessage(`${d.label} is ready.`, 'Retry last run'); if (a) retryCmd(); }
    else vscode.window.showErrorMessage(`${simId}: ${bad.stage} failed. ${bad.next}`, 'Configure Simulators').then(a => { if (a) configureSims(); });
  }
  async function retryCmd() {
    const root = await pickProjectRoot(); if (!root) return;
    out.show(true);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Retry last run (same simulator, tests, seeds)', cancellable: true }, async (p, token) => {
      try { const res = await runner.retry(root, { log: s => out.appendLine(s), token }); vscode.window.showInformationMessage(`${res.meta.simLabel}: ${res.totals.pass}/${res.totals.runs} passed${res.totals.license ? ' · license failures: ' + res.totals.license : ''}`); }
      catch (e) { vscode.window.showErrorMessage(e.message); }
    });
  }
  async function selectSim() {
    const root = await pickProjectRoot(); if (!root) return;
    const f = path.join(root, 'dvflow.json');
    const cfg = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
    const caps = sim.capabilities();
    const p = await vscode.window.showQuickPick(caps.map(c => ({ label: c.label, description: `${c.available ? c.version : 'not found'}${c.id === cfg.simulator ? ' · current' : ''}`, detail: Object.entries(c.caps).map(([k, v]) => `${k}: ${v}`).join(' · '), id: c.id })), { placeHolder: 'Default simulator for this project (stored in dvflow.json; override any time with SIM=...)', matchOnDetail: true });
    if (!p) return;
    cfg.simulator = p.id;
    fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
    vscode.window.showInformationMessage(`Project simulator: ${p.label}. make, the CLI and the extension now default to SIM=${p.id}.`);
  }
  sub(vscode.commands.registerCommand('tenxDebug.dv.configureSimulators', configureSims));
  sub(vscode.commands.registerCommand('tenxDebug.dv.doctor', () => doctorCmd()));
  sub(vscode.commands.registerCommand('tenxDebug.dv.retry', retryCmd));
  sub(vscode.commands.registerCommand('tenxDebug.dv.selectSimulator', selectSim));
  sub(vscode.commands.registerCommand('tenxDebug.dv.runFormal', async () => {
    const root = await pickProjectRoot(); if (!root) return;
    const cfg = runner.loadConfig(root);
    if (!cfg.formal || !cfg.formal.length) { vscode.window.showInformationMessage('Add "formal": [{"name": "...", "sby": "formal/x.sby"}] to dvflow.json.'); return; }
    out.show(true);
    const fj = await formal.run(root, cfg, { log: s => out.appendLine(s) });
    decorate(root);
    vscode.window.showInformationMessage(fj.results.map(r => `${r.name}: ${r.verdict}`).join(' · '));
  }));
}

module.exports = { register };

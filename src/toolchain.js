'use strict';
/*
 * VS Code front end for the container toolchain (src/dv/container.js):
 *   status bar item · "Set Up Open-Source Toolchain" (build / pull the image) · status · terminal in the container ·
 *   stop containers · mode switch · one-time prompt when no open-source simulator is installed.
 */
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const ct = require('./dv/container');

function register(context) {
  const sub = d => context.subscriptions.push(d);
  const out = vscode.window.createOutputChannel('10xEngineers EDA Toolchain');
  sub(out);
  const cfg = () => vscode.workspace.getConfiguration('tenxDebug');
  const dockerDir = path.join(context.extensionUri.fsPath, 'container');

  function applySettings() {
    const c = cfg();
    ct.configure({
      mode: c.get('toolchain.mode', 'auto'), image: c.get('toolchain.image', ''), engine: c.get('toolchain.engine', 'auto'), autoUpdate: c.get('toolchain.autoUpdate', true),
      distro: c.get('toolchain.wslDistro', ''), mounts: c.get('toolchain.mounts', []),
      roots: (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath)
    });
  }
  applySettings();
  sub(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('tenxDebug.toolchain')) { applySettings(); refreshBar(); } }));
  sub(vscode.workspace.onDidChangeWorkspaceFolders(() => { applySettings(); }));

  /* ------------------------------------------------------------ status bar */
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  bar.command = 'tenxDebug.toolchain.status';
  sub(bar);
  let probe = { engine: false, image: false };
  async function refreshBar() {
    const mode = cfg().get('toolchain.mode', 'auto');
    if (mode === 'local') { bar.text = '$(tools) EDA: local tools'; bar.tooltip = 'Open-source tools: local installs only (tenxDebug.toolchain.mode = local)'; bar.show(); return; }
    bar.text = '$(sync~spin) EDA tools'; bar.show();
    probe = await ct.probeAsync().catch(() => ({ engine: false, image: false }));
    if (probe.engine && probe.image) { bar.text = `$(package) EDA: ${mode === 'container' ? 'container' : 'auto'}`; bar.tooltip = `Open-source tools from ${ct.config().image} (${probe.label}); mode ${mode}. Click for status.`; }
    else if (probe.engine) { bar.text = '$(package) EDA: set up tools'; bar.tooltip = `${probe.label} found, image ${ct.config().image} not built yet. Click to set up.`; bar.command = 'tenxDebug.toolchain.setup'; }
    else { bar.text = '$(tools) EDA: local tools'; bar.tooltip = 'No container engine found — using local installs. Click for options.'; }
    if (probe.engine && probe.image) bar.command = 'tenxDebug.toolchain.status';
  }
  refreshBar();

  /* ------------------------------------------------------------ setup */
  async function setup() {
    out.show(true);
    out.appendLine('== Checking for a container engine …');
    ct.invalidate();
    const e = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Checking for Docker / Podman…' }, async () => ct.engine());
    if (e.error) {
      out.appendLine('   ' + e.error);
      const pick = await vscode.window.showWarningMessage(e.error, { modal: true },
        process.platform === 'win32' ? 'Install Docker in WSL (guide)' : 'Install Docker Engine (guide)', 'Docker Desktop', 'Podman');
      if (pick === 'Docker Desktop') vscode.env.openExternal(vscode.Uri.parse('https://docs.docker.com/desktop/'));
      if (pick === 'Podman') vscode.env.openExternal(vscode.Uri.parse('https://podman.io/docs/installation'));
      if (pick && /guide/.test(pick)) {
        const readme = path.join(dockerDir, 'README.md');
        if (fs.existsSync(readme)) vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(readme));
        else vscode.env.openExternal(vscode.Uri.parse('https://docs.docker.com/engine/install/ubuntu/'));
      }
      return;
    }
    out.appendLine('   ' + e.label);
    const image = ct.config().image;
    const im = ct.imageInfo();
    const choices = [
      { label: '$(cloud-download) Download the prebuilt image (recommended)', description: `${image} · about 1.2 GB once · smoke-tested before use`, v: 'pull' },
      { label: '$(tools) Build the image on this machine', description: 'from the Dockerfile shipped with the extension · a few minutes · no registry needed', v: 'build' }
    ];
    if (im.present) choices.unshift({ label: '$(check) Image already present — just check it', description: image, v: 'check' });
    const c = await vscode.window.showQuickPick(choices, { placeHolder: `Open-source toolchain image ${image}` });
    if (!c) return;
    if (c.v !== 'check') {
      const code = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: c.v === 'build' ? `Building ${image} (Icarus, Verilator, UVM, GHDL, Yosys, SymbiYosys, cocotb)` : `Pulling ${image}`, cancellable: true }, (prog, token) => new Promise(res => {
        if (c.v === 'pull') {
          // same path as a first run: progress in the output, one download for all windows, smoke test, fallback
          ct.ensureImage({ log: l => { out.appendLine(l); const m = /(\d+\/\d+ layers ready.*)$/.exec(l); if (m) prog.report({ message: m[1] }); }, token })
            .then(() => res(0), err => { out.appendLine('[toolchain] ' + err.message); vscode.window.showErrorMessage('Download failed: ' + err.message); res(1); });
          return;
        }
        let p;
        try { p = ct.build(dockerDir, d => { out.append(d); const m = /#(\d+) \[[^\]]*?(\d+)\/(\d+)\]/.exec(d); if (m) prog.report({ message: `step ${m[2]}/${m[3]}` }); }); }
        catch (err) { out.appendLine(err.message); return res(-1); }
        token.onCancellationRequested(() => { try { p.kill(); } catch (x) { /* gone */ } });
        p.on('close', res);
      }));
      if (code !== 0) { vscode.window.showErrorMessage(`Toolchain image ${c.v} failed (exit ${code}) — see "10xEngineers EDA Toolchain" output.`); return; }
    }
    ct.invalidate();
    await showStatus(true);
    refreshBar();
  }

  /* ------------------------------------------------------------ status */
  async function showStatus(afterSetup) {
    const s = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'EDA toolchain status' }, async () => ct.status());
    out.appendLine('');
    out.appendLine('== Open-source toolchain');
    out.appendLine(`mode:      ${s.mode}   (tenxDebug.toolchain.mode: auto = local tools first, container otherwise)`);
    out.appendLine(`engine:    ${s.engine.error ? 'NOT AVAILABLE — ' + s.engine.error : s.engine.label}`);
    out.appendLine(`image:     ${s.image} ${s.imageInfo.present ? `(version ${s.imageInfo.version || '?'})` : '(not on this machine yet — downloaded on first use)'}`);
    out.appendLine(`updates:   ${cfg().get('toolchain.autoUpdate', true) ? 'automatic (daily check; switched only after a smoke test)' : 'manual ("Update Simulation Tools")'}`);
    out.appendLine(`container: ${s.container} ${s.running ? '(running)' : '(starts on first use)'}`);
    out.appendLine(`mounted:   ${s.mounts.join('  ·  ')}`);
    Object.entries((s.imageInfo && s.imageInfo.tools) || {}).forEach(([k, v]) => out.appendLine(`  ${k.padEnd(10)} ${v || '—'}`));
    const ok = !s.engine.error && s.imageInfo.present;
    const acts = ok ? ['Update Simulation Tools', 'Open Terminal in Container', 'Check Tools', 'Switch Mode', 'Stop Containers'] : ['Set Up'];
    const msg = ok ? `Open-source toolchain ready${afterSetup ? '' : ''}: ${Object.keys(s.imageInfo.tools || {}).length} tools in ${s.image} via ${s.engine.label} (mode ${s.mode}).` : `Open-source toolchain not ready: ${s.engine.error || 'image not built'}`;
    out.show(true);
    const a = await (ok ? vscode.window.showInformationMessage : vscode.window.showWarningMessage)(msg, ...acts);
    if (a === 'Open Terminal in Container') terminal();
    if (a === 'Check Tools') vscode.commands.executeCommand('tenxDebug.dv.doctor');
    if (a === 'Switch Mode') switchMode();
    if (a === 'Set Up') setup();
    if (a === 'Update Simulation Tools') updateTools(false);
    if (a === 'Stop Containers') stop();
  }

  function terminal() {
    try {
      const ws = (vscode.workspace.workspaceFolders || [])[0];
      const sc = ct.shellCommand(ws ? ws.uri.fsPath : undefined);
      const t = vscode.window.createTerminal({ name: 'EDA tools (container)', shellPath: sc.cmd, shellArgs: sc.args, iconPath: new vscode.ThemeIcon('package') });
      t.show();
    } catch (e) { vscode.window.showErrorMessage('Toolchain terminal: ' + e.message); }
  }
  function stop() { const n = ct.stopAll(); vscode.window.showInformationMessage(`Stopped ${n} toolchain container(s). They start again on the next run.`); refreshBar(); }
  async function switchMode() {
    const cur = cfg().get('toolchain.mode', 'auto');
    const p = await vscode.window.showQuickPick([
      { label: 'auto', description: 'local tools when installed, container otherwise (recommended)' },
      { label: 'container', description: 'always run Icarus / Verilator / GHDL / Yosys / sby in the container' },
      { label: 'local', description: 'never use the container' }
    ].map(x => Object.assign(x, { picked: x.label === cur })), { placeHolder: `Toolchain mode (now: ${cur})` });
    if (p) await cfg().update('toolchain.mode', p.label, vscode.ConfigurationTarget.Global);
  }

  /* ------------------------------------------------------------ updates */
  let updating = null;
  async function updateTools(background) {
    if (updating) { if (!background) out.show(true); return updating; }
    if (!background) out.show(true);
    out.appendLine('\n== Update Simulation Tools');
    updating = vscode.window.withProgress({ location: background ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification, title: 'EDA tools: checking for an update', cancellable: !background }, async (prog, token) => {
      try {
        const r = await ct.update({ log: l => { out.appendLine(l); const m = /(\d+\/\d+ layers ready.*)$/.exec(l); if (m) prog.report({ message: m[1] }); }, token });
        out.appendLine(`[toolchain] ${ct.describe()}`);
        if (r.updated) vscode.window.showInformationMessage(`EDA tools updated to ${r.image} (smoke test passed). The next run uses it.`);
        else if (!background) vscode.window.showInformationMessage(r.reason === 'up to date' ? `EDA tools are up to date (${r.image}).` : `EDA tools not updated: ${r.reason}. Still using ${r.image}.`);
        refreshBar();
        return r;
      } catch (err) {
        out.appendLine('[toolchain] ' + err.message);
        if (!background) vscode.window.showErrorMessage('Update Simulation Tools: ' + err.message);
        return { updated: false, reason: err.message };
      } finally { updating = null; }
    });
    return updating;
  }
  // daily, a minute after start-up, when Docker and the image are already there (first-run downloads happen on demand)
  setTimeout(async () => {
    if (cfg().get('toolchain.mode', 'auto') === 'local') return;
    const p = await ct.probeAsync().catch(() => ({ engine: false }));
    if (!p.engine || !p.image) return;
    const chk = await ct.checkForUpdate({}).catch(err => ({ error: err.message }));
    if (!chk.update) return;
    if (cfg().get('toolchain.autoUpdate', true)) { out.appendLine(`[toolchain] update ${chk.latest} found — downloading in the background`); updateTools(true); }
    else {
      const a = await vscode.window.showInformationMessage(`An update of the simulation tools is available: ${chk.current} → ${chk.latest}.`, 'Update Now', 'Later');
      if (a === 'Update Now') updateTools(false);
    }
  }, 60000);

  const reg = (id, fn) => sub(vscode.commands.registerCommand(id, fn));
  reg('tenxDebug.toolchain.update', () => updateTools(false));
  reg('tenxDebug.toolchain.setup', setup);
  reg('tenxDebug.toolchain.status', () => showStatus(false));
  reg('tenxDebug.toolchain.terminal', terminal);
  reg('tenxDebug.toolchain.stop', stop);
  reg('tenxDebug.toolchain.mode', switchMode);

  /* ------------------------------------------------------------ first-run prompt */
  setTimeout(async () => {
    if (context.globalState.get('tenxDebug.toolchain.dontAsk') || cfg().get('toolchain.mode', 'auto') === 'local') return;
    const sim = require('./dv/sim');
    const localSim = ['icarus', 'verilator'].some(id => !sim.resolveLocal(sim.ADAPTERS[id]).missing.length);   // local lookup only: never blocks on Docker
    if (localSim) return;
    const p = await ct.probeAsync().catch(() => ({ engine: false }));
    if (p.engine && p.image) return;
    const a = await vscode.window.showInformationMessage(
      p.engine ? `No open-source simulator is installed. ${p.label} is available — set up the 10xEngineers EDA toolchain image (Icarus, Verilator, UVM, GHDL, Yosys, SymbiYosys, cocotb) so nothing else needs installing?`
        : 'No open-source simulator is installed. Install Docker (or Podman) and the extension can run Icarus, Verilator, UVM, Yosys and cocotb from a container — no other installs.',
      p.engine ? 'Set Up Toolchain' : 'How?', 'Not Now', "Don't Ask Again");
    if (a === 'Set Up Toolchain' || a === 'How?') setup();
    if (a === "Don't Ask Again") context.globalState.update('tenxDebug.toolchain.dontAsk', true);
  }, 6000);
}

module.exports = { register };

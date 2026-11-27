// End-to-end: runs every contributed command of 10xEngineers EDA inside a real VS Code, answering prompts automatically.
// Writes results.json next to this file. Pick lists: first item unless a rule below matches; input boxes: their default;
// confirmations (modal) are declined so nothing is overwritten; window reloads / folder switches are blocked.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const OUT = process.env.TENX_E2E_OUT || path.join(__dirname, "results.json");
const WS = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// placeholder/prompt regex -> preferred item label regex
const PICK_RULES = [
  [/simulator|Simulator/, /icarus|Icarus/],
  [/UVM testbench with which/, /verilator|Verilator/],
  [/Which testbench|Testbench to run|What to run|kind/i, /Simple|lightweight/i],
  [/Suite/, /^full|smoke/],
  [/Waveform/, /fail|Only if/],
  [/Coverage|coverage/, /Functional \+ code|both|Functional/],
  [/DV project/, /adder/],
  [/Template|template/, /adder/],
  [/Top module|top module/, /adder4/],
  [/Testbench mode|What to generate|Generate/, /All|SV \+ UVM/],
  [/Test$|^Test/, /smoke/],
];

exports.run = async function run() {
  const res = { started: new Date().toISOString(), commands: [], prompts: 0, unhandled: [] };
  process.on('unhandledRejection', e => res.unhandled.push(String(e && e.stack || e).slice(0, 400)));
  const S = global.__E2E = global.__E2E || { cur: null, prompts: 0 };
  let cur = null;
  const W = vscode.window;
  const origExec = vscode.commands.executeCommand.bind(vscode.commands);
  const ext = vscode.extensions.all.find(e => /10xengineer-eda/i.test(e.id));
  res.extension = ext ? `${ext.id} ${ext.packageJSON.version}` : 'NOT FOUND';
  if (!ext) { fs.writeFileSync(OUT, JSON.stringify(res, null, 2)); return; }
  const t0 = Date.now();
  try { await ext.activate(); res.activateMs = Date.now() - t0; res.hooked = !!S.hooked; } catch (e) { res.activateError = String(e.stack || e); }

  const ws = WS();
  const adder = path.join(ws, 'adder', 'design', 'adder.sv');
  const fsmFile = path.join(ws, 'fsm', 'traffic_light.sv');
  const wavedrom = path.join(ws, 'fsm', 'handshake.wavedrom');
  const find = (dir, re, acc = []) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); const st = fs.statSync(p); if (st.isDirectory()) { if (!/node_modules|\.dvflow/.test(f)) find(p, re, acc); } else if (re.test(f)) acc.push(p); } return acc; };
  const vcd = find(path.join(ws, 'adder', 'runs'), /^waves\.vcd$/)[0];
  const xlsx = path.join(ws, 'adder', 'testplan', 'testplan.xlsx');
  const openDoc = async f => { const d = await vscode.workspace.openTextDocument(f); await W.showTextDocument(d, { preview: false }); return d; };
  const placeCursor = async (f, word) => { const d = await openDoc(f); const i = d.getText().indexOf(word); if (i >= 0) { const p = d.positionAt(i + 1); W.activeTextEditor.selection = new vscode.Selection(p, p); } };

  // command -> [setup, args]
  const pre = {
    'tenxDebug.openWaveform': [null, () => [vscode.Uri.file(vcd)]],
    'tenxDebug.wave.diff': [null, () => [vscode.Uri.file(vcd)]],
    'tenxDebug.xlsx.view': [null, () => [vscode.Uri.file(xlsx)]],
    'tenxDebug.showFsm': [() => openDoc(fsmFile)],
    'tenxDebug.copyFsmMermaid': [() => openDoc(fsmFile)],
    'tenxDebug.wavedrom.preview': [() => openDoc(wavedrom)],
    'tenxDebug.wavedrom.exportSva': [() => openDoc(wavedrom)],
    'tenxDebug.showDrivers': [() => placeCursor(adder, 'sum')],
    'tenxDebug.showLoads': [() => placeCursor(adder, 'a,')],
    'tenxDebug.showAssertCover': [() => placeCursor(adder, 'sum')],
    'tenxDebug.netlist.whatDrives': [() => placeCursor(adder, 'sum')],
    'tenxDebug.netlist.whatLoads': [() => placeCursor(adder, 'a,')],
  };
  const SKIP = new Set(['tenxDebug.demo.create', 'tenxDebug.toolchain.stop', 'tenxDebug.toolchain.terminal']);   // window switch / stops the toolchain mid-test / opens a shell
  const LONG = /runRegression|runTest|signoff|gls|formalProve|runFormal|mutate|synth|runQuesta|generateTestbench|doctor|selectDut|toolchain/;

  const cmds = ext.packageJSON.contributes.commands.map(c => c.command);
  for (const id of cmds) {
    cur = S.cur = { id, status: 'ok', ms: 0, events: [], errors: [] };
    res.commands.push(cur);
    if (SKIP.has(id)) { cur.status = 'skipped'; continue; }
    const t = Date.now();
    try {
      await openDoc(adder);   // most commands work on the active RTL file
      const p = pre[id];
      if (p && p[0]) await p[0]();
      const args = p && p[1] ? p[1]() : [];
      const limit = LONG.test(id) ? 420000 : 45000;
      const r = await Promise.race([origExec(id, ...args).then(() => 'done'), sleep(limit).then(() => 'timeout')]);
      if (r === 'timeout') cur.status = 'timeout';
      await sleep(700);   // let notifications / async follow-ups land
    } catch (e) { cur.status = 'threw'; cur.errors.push(String(e && e.message || e).slice(0, 300)); }
    cur.ms = Date.now() - t;
    if (cur.status === 'ok' && cur.errors.length) cur.status = 'error-message';
    fs.writeFileSync(OUT, JSON.stringify(res, null, 2));   // progress
  }
  // views: open each one once
  res.views = [];
  for (const v of ['tenxDebug.fsmExplorer', 'tenxDebug.waveFiles', 'tenxDebug.coverageFiles', 'tenxDebug.designHierarchy', 'tenxDebug.uvmHierarchy']) {
    try { await origExec(v + '.focus'); res.views.push(v + ': ok'); } catch (e) { res.views.push(v + ': ' + e.message); }
  }
  res.prompts = S.prompts; res.finished = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
};

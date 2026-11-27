// Loaded by the extension itself (TENX_E2E_HOOK): wraps the extension's own vscode API so prompts are answered.
// State is shared with the test runner through global.__E2E (same extension-host process).
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PICK_RULES = [
  [/New design from the library/, /^alu4$/],
  [/UVM testbench with which/, /verilator|Verilator/],
  [/simple testbench with which|simulator|Simulator/, /icarus|Icarus/],
  [/Testbench|testbench to run|What to run|Run which/i, /Simple|lightweight|SV/i],
  [/Suite/, /^smoke$|^full$/],
  [/Waveform/, /fail|Only if/],
  [/[Cc]overage/, /Functional \+ code|both|Functional/],
  [/DV project/, /adder/],
  [/[Tt]emplate/, /adder/],
  [/[Tt]op module/, /adder4/],
  [/[Dd]ependencies|Add source/, /^$/],
  [/Testbench mode|What to generate|Generate/, /^All|SV \+ UVM \+ cocotb|All:/],
  [/^Test$|Test\b/, /smoke/],
  [/UVM tests to run/, /smoke/],
];
module.exports = function (vscode) {
  const S = global.__E2E = global.__E2E || { cur: null, prompts: 0 };
  const note = (kind, text) => { S.prompts++; if (S.cur) S.cur.events.push(`${kind}: ${String(text || '').replace(/\s+/g, ' ').slice(0, 220)}`); };
  const W = vscode.window;
  W.showQuickPick = async (items, opts) => {
    items = await items; const arr = Array.isArray(items) ? items : [];
    const ph = (opts && (opts.placeHolder || opts.title)) || '';
    const label = i => typeof i === 'string' ? i : String(i.label || '');
    let choice = arr.find(i => !(i && i.kind === -1)) || arr[0];
    for (const [p, l] of PICK_RULES) if (p.test(ph)) { const hit = arr.find(i => l.test(label(i).replace(/\$\([^)]*\)\s*/g, ''))); if (hit) { choice = hit; break; } }
    note('pick', `${ph} -> ${choice ? label(choice) : '(none)'}  [${arr.length} items]`);
    if (!arr.length) return undefined;
    if (opts && opts.canPickMany) { const pre = arr.filter(i => i && i.picked); return pre.length ? pre : [choice]; }
    return choice;
  };
  W.showInputBox = async opts => { const v = opts && opts.value != null && opts.value !== '' ? opts.value : '1'; note('input', `${opts && (opts.prompt || opts.placeHolder)} -> ${v}`); return v; };
  for (const k of ['showInformationMessage', 'showWarningMessage', 'showErrorMessage']) {
    W[k] = async (msg, ...rest) => {
      const modal = rest[0] && typeof rest[0] === 'object' && !rest[0].title && rest[0].modal;
      note(k.replace('show', '').replace('Message', '') + (modal ? '(modal: declined)' : ''), msg);
      if (S.cur && k === 'showErrorMessage') S.cur.errors.push(String(msg).slice(0, 300));
      return undefined;   // dismiss: never confirms an overwrite or a send
    };
  }
  W.showOpenDialog = async () => { note('openDialog', ''); return undefined; };
  W.showSaveDialog = async () => { note('saveDialog', ''); return undefined; };
  const exec = vscode.commands.executeCommand.bind(vscode.commands);
  vscode.commands.executeCommand = (id, ...a) => {
    if (/^(vscode\.openFolder|workbench\.action\.reloadWindow|workbench\.action\.files\.openFolder|vscode\.newWindow)$/.test(id)) { note('blocked', id); return Promise.resolve(); }
    return exec(id, ...a);
  };
  S.hooked = true;
};

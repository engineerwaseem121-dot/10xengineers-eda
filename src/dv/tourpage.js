'use strict';
/* Demo Tour: the steps and the panel that shows them. The actions themselves run in ext.js. */

const STEPS = [
  { id: 'tools', title: 'Check the open-source toolchain', act: 'Check tools',
    what: 'Shows the simulators and tools the extension found: Icarus, Verilator with UVM, Yosys, SymbiYosys, cocotb, in Docker or installed locally.',
    benefit: 'Nobody installs simulators one by one: Docker plus this extension is the whole set-up.', cli: 'dvflow toolchain status' },
  { id: 'files', title: 'See what one RTL file turned into', act: 'Open the test plan',
    what: 'The demo started from a single file, adder.sv. The extension created dvflow.json, a self-checking SV testbench (tb/), a UVM environment (uvm/), a cocotb testbench (cocotb/) and a test plan with requirements.',
    benefit: 'Hours of testbench writing become seconds. The reference model comes from the spec, not the RTL, so an RTL bug can\'t hide inside the checker.', cli: 'dvflow init --file adder.sv' },
  { id: 'regress', title: 'Run a regression', act: 'Run on Icarus',
    what: 'Runs smoke, boundary, exhaustive and random tests with 3 seeds each (12 runs), with waveforms. testplan.yaml and testplan.xlsx are updated with the results.',
    benefit: 'Self-checking, reproducible by seed, and every requirement gets evidence it passed.', cli: 'dvflow regress --sim icarus --suite full --waves 1' },
  { id: 'dashboard', title: 'Explore the dashboard', act: 'Open dashboard',
    what: 'Click a cell of the test × seed grid: the run opens with its log and waveform. Try Coverage, Traceability, History, and Ctrl+K to search.',
    benefit: 'One page answers "did it pass, what was covered, which requirement is verified, what changed since last time".', cli: '' },
  { id: 'coverage', title: 'Measure code coverage (Verilator)', act: 'Run with coverage',
    what: 'Runs the regression on Verilator with code coverage: expression, toggle, line and branch coverage of the DUT, plus a list of what no test exercised.',
    benefit: 'Code coverage without a commercial license, pointing at the exact lines and conditions the tests missed.', cli: 'dvflow regress --sim verilator --suite full --cov 1' },
  { id: 'uvm', title: 'Run the UVM testbench', act: 'Run UVM on Verilator',
    what: 'Opens the UVM architecture diagram, then runs every UVM test on Verilator. Scoreboard results go to the same dashboard.',
    benefit: 'Real UVM (agent, driver, monitor, scoreboard) with no Questa or VCS license.', cli: 'dvflow uvm --sim verilator --tests smoke,boundary,exhaustive,random' },
  { id: 'cocotb', title: 'Run the cocotb (Python) testbench', act: 'Run cocotb',
    what: 'The same scenarios, checked by a Python reference model with cocotb.',
    benefit: 'Teams that prefer Python get the same tests, scenario IDs and dashboard as the SV and UVM flows.', cli: 'dvflow cocotb --sim icarus' },
  { id: 'bug', title: 'Plant a bug and watch it get caught', act: 'Inject bug + run',
    what: 'Changes the carry logic in adder.sv (a copy of the original is kept), then runs the regression again. Open Failures: the failing check, the mismatch, triage notes, and the time in the log jumps the waveform cursor.',
    benefit: 'From "a test failed" to "this output, this input, this time" in one click.', cli: '' },
  { id: 'formal', title: 'Formal proof', act: 'Prove',
    what: 'Proves the DUT equals the reference model for every possible input, not only the tests that ran. With the bug in place it fails and names the output, with a counterexample waveform.',
    benefit: 'Exhaustive certainty in seconds, without writing a single property.', cli: 'dvflow signoff --steps formal' },
  { id: 'fix', title: 'Fix it and confirm', act: 'Restore DUT + rerun',
    what: 'Puts the original adder.sv back and runs again. In History → Compare, the failing tests now show as "fixed".',
    benefit: 'Regression history shows what broke and what each change fixed.', cli: '' },
  { id: 'mutation', title: 'Measure testbench quality', act: 'Mutation test',
    what: 'Plants small bugs in copies of the DUT and checks how many the tests catch. Survivors that Yosys proves logically identical to the original are marked equivalent, not counted as holes.',
    benefit: 'Proves the testbench would catch bugs, not just that it passes.', cli: 'dvflow mutate --sim icarus' },
  { id: 'signoff', title: 'Sign-off check', act: 'Run sign-off',
    what: 'Lint, synthesis (cells, latches, logic depth), RTL-vs-netlist equivalence, gate-level simulation on the netlist, and the formal proof, in one go.',
    benefit: 'A single checklist that says whether the block is ready.', cli: 'dvflow signoff' }
];

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html(state) {
  const done = state.done || {};
  const n = STEPS.filter(s => done[s.id]).length;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
:root{--bg:var(--vscode-editor-background,#1e1e1e);--fg:var(--vscode-foreground,#ddd);--muted:var(--vscode-descriptionForeground,#999);--line:var(--vscode-panel-border,#3c3c3c);--panel:var(--vscode-sideBar-background,#252526);--btn:var(--vscode-button-background,#0e639c);--btnfg:var(--vscode-button-foreground,#fff);--ok:var(--vscode-charts-green,#89d185);--warn:var(--vscode-charts-orange,#d18616);--accent:var(--vscode-textLink-foreground,#3794ff)}
body{background:var(--bg);color:var(--fg);font:13.5px/1.55 var(--vscode-font-family,"Segoe UI",sans-serif);margin:0}
main{max-width:920px;margin:0 auto;padding:22px 20px 60px;display:grid;gap:14px}
h1{font-size:20px;margin:0}.sub{color:var(--muted)}
.bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;background:var(--ok)}
.step{display:grid;grid-template-columns:34px 1fr auto;gap:14px;align-items:start;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.step.done{border-color:color-mix(in srgb,var(--ok) 55%,var(--line))}
.num{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:700;border:2px solid var(--line);color:var(--muted)}
.done .num{background:var(--ok);border-color:var(--ok);color:#111}
h2{font-size:14.5px;margin:0 0 4px}
.what{margin:0 0 6px}.ben{margin:0;color:var(--ok)}.ben b{font-weight:600}
code{font-family:var(--vscode-editor-font-family,Consolas,monospace);font-size:12px;color:var(--muted)}
button{background:var(--btn);color:var(--btnfg);border:0;border-radius:4px;padding:6px 14px;cursor:pointer;white-space:nowrap;font:inherit}
button[disabled]{opacity:.6;cursor:wait}button.sec{background:transparent;color:var(--accent);border:1px solid var(--line)}
.note{border-left:3px solid var(--warn);padding:8px 12px;background:var(--panel)}
.acts{display:grid;gap:6px;justify-items:end}
</style></head><body><main>
<div><h1>10xEngineers EDA: Demo Tour</h1><div class="sub">Project: ${esc(state.root)} · one RTL file (<code>${esc(state.dutFile)}</code>) → testbenches, regression, coverage, UVM, cocotb, formal, sign-off</div></div>
<div class="bar"><i style="width:${Math.round(100 * n / STEPS.length)}%"></i></div>
<div class="sub">${n} of ${STEPS.length} steps done. Each button does the whole step, with no prompts. Run them in order; the bug step needs the regression first.</div>
${state.bug ? '<div class="note"><b>A demo bug is planted in the DUT.</b> Step "Fix it and confirm" puts the original back.</div>' : ''}
${STEPS.map((s, i) => `<div class="step${done[s.id] ? ' done' : ''}" id="s-${s.id}"><div class="num">${done[s.id] ? '✓' : i + 1}</div>
<div><h2>${esc(s.title)}</h2><p class="what">${esc(s.what)}</p><p class="ben"><b>Why it matters:</b> ${esc(s.benefit)}</p>${s.cli ? `<code>CLI: ${esc(s.cli)}</code>` : ''}</div>
<div class="acts"><button data-act="${s.id}">${esc(s.act)}</button>${done[s.id] && /regress|coverage|uvm|cocotb|bug|fix/.test(s.id) ? '<button class="sec" data-act="dashboard">Dashboard</button>' : ''}</div></div>`).join('')}
<div class="sub">Restart the tour any time with <b>10xEngineers EDA: Open Demo Tour</b>. Use your own design with <b>DV: Select DUT</b> (or <code>dvflow init --file your.sv</code>).</div>
</main><script>
const vs = acquireVsCodeApi();
document.addEventListener('click', e => { const b = e.target.closest('button[data-act]'); if (!b) return; document.querySelectorAll('button[data-act]').forEach(x => x.disabled = true); b.textContent = 'Running…'; vs.postMessage({ type: 'act', id: b.getAttribute('data-act') }); });
</script></body></html>`;
}

module.exports = { STEPS, html };

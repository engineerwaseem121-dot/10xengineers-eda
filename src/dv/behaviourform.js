'use strict';
/*
 * "DV: Write Expected Behaviour" — a form for the expected value of every output (custom template, combinational).
 * Lists the inputs with widths, one field per output, checks each expression as it is typed (expr.check + a worked
 * example), offers an optional AI draft (never sent without confirmation, always shown for review), and saves to
 * dvflow.json → behavior.checks, then regenerates the testbenches.
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const expr = require('./expr');
const tbgen = require('./tbgen');
const runner = require('./runner');
const { identify } = require('./identify');
const ET = require('./exprtemplates');

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function openForm(root, deps) {
  const cfgFile = path.join(root, 'dvflow.json');
  const cfgRaw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const cfg = tbgen.withDefaults(cfgRaw);
  const dut = tbgen.resolveDut(cfg, root, {}, f => fs.readFileSync(f, 'utf8'));
  const rtlFile = path.resolve(root, cfg.dut.files[0]);
  const text = fs.readFileSync(rtlFile, 'utf8');
  const id = identify(Object.assign({ name: cfg.dut.top }, { ports: dut.ports }), text);
  const clkRst = new Set([cfg.clock && cfg.clock.name, cfg.reset && cfg.reset.name].filter(Boolean));
  const ins = dut.ports.filter(p => p.dir === 'input' && !clkRst.has(p.name)).map(p => ({ name: p.name, width: p.width || 1 }));
  const outs = dut.ports.filter(p => p.dir === 'output').map(p => ({ name: p.name, width: p.width || 1 }));
  const scope = { inputs: Object.fromEntries(ins.map(p => [p.name, p.width])), outputs: Object.fromEntries(outs.map(p => [p.name, p.width])), params: {} };
  const sequential = !!(cfg.behavior && cfg.behavior.sequential) || dut.ports.some(p => p.name === (cfg.clock && cfg.clock.name));

  // starting values: written checks, else the identified template's expressions, else an ALU starter table
  const current = {};
  for (const o of outs) {
    const v = cfg.behavior && cfg.behavior.checks && cfg.behavior.checks[o.name];
    if (v && !/\/\*\s*expected/.test(String(v))) current[o.name] = { text: String(v).replace(/\bin_(\w+)/g, (m, n) => (scope.inputs[n] != null ? n : m)), from: 'dvflow.json' };
  }
  if (ET.TEMPLATE_SPECS[id.template]) {
    try { const s = ET.TEMPLATE_SPECS[id.template](cfg, dut.ports); for (const [k, v] of Object.entries(s.checks)) if (!current[k]) current[k] = { text: v, from: `suggested for a ${id.label}` }; } catch (e) { /* ports do not fit the template: leave empty */ }
  }
  if (id.template === 'alu') {
    const op = ins.find(p => /op|sel|func|ctrl/i.test(p.name)), a = ins.find(p => /^a$|^x$|in1|op1|a_i/i.test(p.name)) || ins[0], b = ins.find(p => p !== a && p !== op);
    const res = outs.find(o => /result|res|out|^y$/i.test(o.name));
    if (op && a && b && res && !current[res.name]) current[res.name] = { text: `${op.name} == 0 ? ${a.name} + ${b.name} : ${op.name} == 1 ? ${a.name} - ${b.name} : ${op.name} == 2 ? ${a.name} & ${b.name} : ${op.name} == 3 ? ${a.name} | ${b.name} : ${a.name} ^ ${b.name}`, from: 'ALU starter: CHECK THE OPCODE TABLE AGAINST YOUR SPEC' };
    const z = outs.find(o => /^(zero|z|zf)$/i.test(o.name));
    if (z && res && !current[z.name] && current[res.name]) current[z.name] = { text: `(${current[res.name].text}) == 0`, from: 'zero flag of the result' };
  }

  const panel = vscode.window.createWebviewPanel('tenxDebug.behaviourForm', `Expected behaviour: ${cfg.dut.top}`, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  const nonce = crypto.randomBytes(16).toString('hex');
  const comments = (text.match(/\/\/.*|\/\*[\s\S]*?\*\//g) || []).join('\n').slice(0, 3000);
  panel.webview.html = page(nonce, panel.webview.cspSource, { top: cfg.dut.top, id, ins, outs, current, sequential, aiOn: deps.aiEnabled() });

  const validate = (name, t) => {
    const o = outs.find(x => x.name === name);
    const c = expr.check(t, Object.assign({}, scope, { outWidth: o ? o.width : 0 }));
    let sample = null;
    if (c.ok) {
      try {
        const v = Object.fromEntries(ins.map(p => [p.name, BigInt(Math.floor(Math.random() * Math.min(2 ** Math.min(p.width, 30), 1e9)))]));
        const r = expr.evaluate(expr.parse(t), scope, v, o.width);
        sample = `${ins.map(p => `${p.name}=${v[p.name]}`).join(', ')}  →  ${name} = ${r == null ? 'x (divide by zero)' : `${r} (0x${r.toString(16)})`}`;
      } catch (e) { sample = null; }
    }
    return { name, ok: c.ok, errors: c.errors, warnings: c.warnings, width: c.width, sample };
  };

  panel.webview.onDidReceiveMessage(async m => {
    if (m.type === 'validate') panel.webview.postMessage(Object.assign({ type: 'validated' }, validate(m.name, m.text)));
    else if (m.type === 'ai') {
      const prompt = `You write the expected-value expressions for a combinational SystemVerilog module, for a self-checking testbench.
Module ${cfg.dut.top}. Inputs: ${ins.map(p => `${p.name}[${p.width}]`).join(', ')}. Outputs: ${outs.map(p => `${p.name}[${p.width}]`).join(', ')}.
Specification from the engineer:
${m.spec || '(none)'}
Comments from the RTL file:
${comments || '(none)'}
Rules: one SystemVerilog expression per output, using only the input names, numbers, operators (+ - * / % & | ^ ~ ! << >> == != < > <= >= && || ?:), [i], [h:l] with constant bounds, {a,b}, {n{a}}, $signed().
Do NOT read the RTL implementation; derive the behaviour from the specification. Answer with JSON only: {"checks": {"<output>": "<expression>"}, "notes": "<assumptions>"}`;
      const model = await deps.aiGate('the module ports, the RTL comments and your specification text', prompt);
      if (!model) { panel.webview.postMessage({ type: 'ai', error: 'AI is off or the request was not confirmed.' }); return; }
      try {
        const answer = await deps.aiAsk(model, prompt);
        const j = JSON.parse((answer.match(/\{[\s\S]*\}/) || ['{}'])[0]);
        panel.webview.postMessage({ type: 'ai', checks: j.checks || {}, notes: j.notes || '' });
      } catch (e) { panel.webview.postMessage({ type: 'ai', error: 'Could not read the AI answer: ' + e.message }); }
    } else if (m.type === 'save') {
      const checks = {};
      for (const [k, v] of Object.entries(m.checks || {})) {
        const r = validate(k, v);
        if (!r.ok) { panel.webview.postMessage({ type: 'saved', error: `${k}: ${r.errors[0]}` }); return; }
        checks[k] = v;
      }
      const j = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      j.template = 'custom';
      j.behavior = Object.assign({}, j.behavior || {}, { checks, sequential: false });
      delete j.behavior.model_step; delete j.behavior.model_decl; delete j.behavior.model_reset;
      if (m.spec) j.behavior.spec = m.spec;
      fs.writeFileSync(cfgFile, JSON.stringify(j, null, 2) + '\n');
      panel.webview.postMessage({ type: 'saved', ok: true });
      deps.log(`[behaviour] ${cfg.dut.top}: expected values saved for ${Object.keys(checks).join(', ')} (dvflow.json)`);
      if (m.generate) vscode.commands.executeCommand('tenxDebug.dv.generateTestbench');
    }
  });
  return panel;
}

function page(nonce, csp, d) {
  const rows = d.outs.map(o => {
    const c = d.current[o.name] || { text: '', from: '' };
    return `<div class="row" data-name="${esc(o.name)}"><div class="lab"><b>${esc(o.name)}</b> <span class="w">[${o.width}]</span></div>
      <input class="ex" data-name="${esc(o.name)}" value="${esc(c.text)}" placeholder="e.g. ${esc(d.ins.slice(0, 2).map(p => p.name).join(' + ') || 'a + b')}" spellcheck="false">
      <div class="src">${esc(c.from)}</div><div class="msg" id="m-${esc(o.name)}"></div></div>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px 20px;max-width:980px}
h1{font-size:18px;margin:0 0 4px} .id{color:var(--vscode-descriptionForeground);margin-bottom:12px}
.ins{font-family:var(--vscode-editor-font-family);background:var(--vscode-textBlockQuote-background);padding:8px 10px;border-radius:4px;margin:8px 0 14px}
.row{margin:10px 0 14px} .lab{margin-bottom:3px} .w{color:var(--vscode-descriptionForeground)}
input.ex{width:100%;box-sizing:border-box;font-family:var(--vscode-editor-font-family);font-size:13px;padding:6px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:3px}
.src{font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px} .msg{font-size:12px;margin-top:3px;font-family:var(--vscode-editor-font-family)}
.ok{color:var(--vscode-testing-iconPassed,#3fb950)} .bad{color:var(--vscode-errorForeground)} .warn{color:var(--vscode-editorWarning-foreground)}
textarea{width:100%;box-sizing:border-box;min-height:70px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);font-family:var(--vscode-font-family);padding:6px}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:6px 14px;border-radius:3px;cursor:pointer;margin-right:8px}
button.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.bar{margin-top:16px} .note{font-size:12px;color:var(--vscode-descriptionForeground)} code{font-family:var(--vscode-editor-font-family)}
</style></head><body>
<h1>Expected behaviour of ${esc(d.top)}</h1>
<div class="id">Identified as <b>${esc(d.id.label)}</b> (${esc(d.id.confidence)} confidence)${d.id.reasons.length ? ': ' + esc(d.id.reasons.join('; ')) : ''}</div>
${d.sequential ? '<p class="warn">This design has a clock. This form writes combinational expected values; for clocked designs also describe the state in dvflow.json → behavior.model_decl / model_step.</p>' : ''}
<div class="note">Write each output as a SystemVerilog expression of the inputs, from the <b>specification</b> (not from the RTL, or the test only checks the RTL against itself). Example: <code>sel == 0 ? a : b</code>, <code>a + b</code>, <code>{a[3:0], b[7:4]}</code>, <code>$signed(a) &lt; $signed(b)</code>.</div>
<div class="ins"><b>Inputs:</b> ${d.ins.map(p => `${esc(p.name)} [${p.width}]`).join(' · ') || 'none'}</div>
${rows}
<details ${d.aiOn ? '' : 'open'}><summary>Specification text${d.aiOn ? ' / AI draft' : ''}</summary>
<p class="note">Paste the part of the spec that describes the outputs. ${d.aiOn ? '“AI draft” sends the port list, the RTL comments and this text (after you confirm), and fills the fields for review.' : 'AI drafting is off (setting tenxDebug.dv.ai.enable).'}</p>
<textarea id="spec" placeholder="e.g. op=0 add, op=1 subtract, op=2 AND, op=3 OR, otherwise XOR; zero is 1 when the result is 0"></textarea>
${d.aiOn ? '<button class="sec" id="ai">AI draft</button><span id="aimsg" class="note"></span>' : ''}</details>
<div class="bar"><button id="save">Save &amp; generate testbenches</button><button class="sec" id="saveonly">Save only</button><span id="smsg"></span></div>
<script nonce="${nonce}">
const vs = acquireVsCodeApi();
const t = {};
document.querySelectorAll('input.ex').forEach(i => {
  const go = () => { clearTimeout(t[i.dataset.name]); t[i.dataset.name] = setTimeout(() => vs.postMessage({ type: 'validate', name: i.dataset.name, text: i.value }), 180); };
  i.addEventListener('input', go); if (i.value) go();
});
window.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'validated') {
    const el = document.getElementById('m-' + m.name); if (!el) return;
    el.className = 'msg ' + (m.ok ? (m.warnings.length ? 'warn' : 'ok') : 'bad');
    el.textContent = m.ok ? ('✓ ' + m.width + '-bit expression' + (m.warnings.length ? ' · ' + m.warnings.join(' · ') : '') + (m.sample ? '   e.g. ' + m.sample : '')) : '✗ ' + m.errors.join(' · ');
  }
  if (m.type === 'ai') {
    const s = document.getElementById('aimsg');
    if (m.error) { s.textContent = ' ' + m.error; return; }
    for (const [k, v] of Object.entries(m.checks)) { const i = document.querySelector('input.ex[data-name="' + k + '"]'); if (i) { i.value = v; i.dispatchEvent(new Event('input')); const src = i.parentElement.querySelector('.src'); if (src) src.textContent = 'AI draft: review before saving'; } }
    s.textContent = ' Drafted. Review every field. ' + (m.notes || '');
  }
  if (m.type === 'saved') { const s = document.getElementById('smsg'); s.className = m.ok ? 'ok' : 'bad'; s.textContent = m.ok ? ' Saved to dvflow.json' : ' ' + m.error; }
});
const collect = () => Object.fromEntries([...document.querySelectorAll('input.ex')].filter(i => i.value.trim()).map(i => [i.dataset.name, i.value.trim()]));
document.getElementById('save').onclick = () => vs.postMessage({ type: 'save', checks: collect(), spec: document.getElementById('spec').value, generate: true });
document.getElementById('saveonly').onclick = () => vs.postMessage({ type: 'save', checks: collect(), spec: document.getElementById('spec').value, generate: false });
const ai = document.getElementById('ai'); if (ai) ai.onclick = () => vs.postMessage({ type: 'ai', spec: document.getElementById('spec').value });
</script></body></html>`;
}

module.exports = { openForm };

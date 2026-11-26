'use strict';
/*
 * Sign-off check: everything a DV engineer wants to know before calling a block done, open-source tools only.
 *   lint    Verilator -Wall on the DUT
 *   synth   Yosys synthesis: cells, flip-flops, inferred latches, logic depth, design problems; gate netlist
 *   lec     RTL vs gate netlist, formally equivalent?
 *   gls     the SV testbench re-run on the gate netlist (gate-level simulation), with its own dashboard
 *   formal  the DUT proven equal to the reference model for every input sequence (prove), coverage bins reachable (cover)
 * Each step runs alone too (steps option). Results: runs/<id>-signoff/{signoff.json, signoff.html}.
 */
const fs = require('fs');
const path = require('path');
const runner = require('./runner');
const synth = require('./synth');

const STEPS = ['lint', 'synth', 'lec', 'gls', 'formal'];
const rel = (from, p) => path.relative(from, p).replace(/\\/g, '/');

async function run(root, o) {
  o = o || {};
  const log = o.log || (() => {});
  const cfg = runner.loadConfig(root);
  const steps = (o.steps && o.steps.length ? o.steps : STEPS).filter(s => STEPS.includes(s));
  const id = `${runner.nowId()}-signoff`;
  const dir = path.join(root, 'runs', id);
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const R = { id, dut: cfg.dut.top, template: cfg.template, files: cfg.dut.files, started: new Date(t0).toISOString(), steps, results: {} };
  log(`== sign-off ${id}: ${cfg.dut.top} — ${steps.join(' → ')}`);
  const stop = () => o.token && o.token.isCancellationRequested;

  if (steps.includes('lint') && !stop()) {
    const l = synth.lint(root, cfg, log);
    R.results.lint = Object.assign(l, { verdict: l.state === 'unavailable' ? 'skipped' : l.errors ? 'fail' : l.warnings ? 'warn' : 'pass' });
  }
  let sy = null;
  if ((steps.includes('synth') || steps.includes('lec') || steps.includes('gls')) && !stop()) {
    sy = synth.synthesize(root, cfg, path.join(dir, 'synth'), log);
    const v = sy.state !== 'done' ? (sy.state === 'unavailable' ? 'skipped' : 'fail') : sy.latches || sy.checkProblems ? 'warn' : 'pass';
    R.results.synth = Object.assign({}, sy, { verdict: v, netlist: sy.netlist && rel(dir, sy.netlist), json: sy.json && rel(dir, sy.json), log: sy.log && rel(dir, sy.log) });
  }
  if (steps.includes('lec') && !stop()) {
    if (sy && sy.state === 'done') {
      const e = synth.lec(root, cfg, sy.netlist, log);
      R.results.lec = Object.assign(e, { verdict: e.state === 'equivalent' ? 'pass' : e.state === 'unproven' || e.state === 'error' ? 'warn' : 'fail' });
    } else R.results.lec = { verdict: 'skipped', message: 'synthesis did not produce a netlist' };
  }
  if (steps.includes('gls') && !stop()) {
    if (sy && sy.state === 'done') {
      const simId = o.glsSim || 'icarus';
      log(`[gls] ${cfg.tests.join(', ')} on the gate netlist (${simId})`);
      try {
        const res = await runner.regress(root, { sim: simId, suite: 'full', seeds: o.seeds || [cfg.seeds[0] || 1], compileFiles: [sy.netlist], kind: 'gls', waves: 1, log: s => { if (/^\[(PASS|FAIL|ERROR|TIMEOUT|LICENSE|BLOCKED)/.test(s)) log('[gls] ' + s); }, token: o.token, override: o.override });
        const t = res.totals;
        R.results.gls = { runId: res.meta.runId, simulator: res.meta.simLabel, runs: t.runs, pass: t.pass, fail: t.fail + t.timeout, other: t.runs - t.pass - t.fail - t.timeout,
          firstError: (res.runs.find(r => r.status !== 'PASS') || {}).firstError || null, report: rel(dir, path.join(root, 'runs', res.meta.runId, 'report', 'index.html')),
          verdict: t.runs && t.pass === t.runs ? 'pass' : t.fail + t.timeout ? 'fail' : 'warn' };
        log(`[gls] ${t.pass}/${t.runs} passed on the netlist`);
      } catch (e) { R.results.gls = { verdict: 'fail', message: e.message }; log('[gls] ' + e.message); }
    } else R.results.gls = { verdict: 'skipped', message: 'synthesis did not produce a netlist' };
  }
  if (steps.includes('formal') && !stop()) R.results.formal = await formalStep(root, cfg, dir, log);

  R.seconds = Math.round((Date.now() - t0) / 100) / 10;
  const vs = Object.values(R.results).map(r => r.verdict);
  R.verdict = vs.includes('fail') ? 'fail' : vs.includes('warn') ? 'warn' : vs.length && vs.every(v => v === 'skipped') ? 'skipped' : 'pass';
  fs.writeFileSync(path.join(dir, 'signoff.json'), JSON.stringify(R, null, 2));
  fs.writeFileSync(path.join(dir, 'signoff.html'), html(R, root, dir));
  R.dir = dir; R.report = path.join(dir, 'signoff.html');
  log(`== sign-off ${R.verdict.toUpperCase()} (${R.seconds}s) · ${Object.entries(R.results).map(([k, v]) => `${k}: ${v.verdict}`).join(' · ')} · report: ${rel(root, R.report)}`);
  return R;
}

async function formalStep(root, cfg, dir, log) {
  const fg = require('./formalgen');
  let g;
  try { g = fg.generate(root, cfg); } catch (e) { return { verdict: 'fail', message: 'could not build the formal harness: ' + e.message }; }
  if (!g.supported) { log(`[formal] skipped: ${g.reason}`); return { verdict: 'skipped', message: g.reason }; }
  for (const [f, c] of Object.entries(g.files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c); }
  log(`[formal] harness ${Object.keys(g.files).join(', ')}: ${g.asserts.length} assertion(s), ${g.covers.filter(c => c.line).length} cover(s)`);
  const formal = require('./formal');
  const fr = await formal.run(root, { formal: [{ name: 'prove', sby: g.sby, task: 'prove', timeout_s: 1200 }, { name: 'cover', sby: g.sby, task: 'cover', timeout_s: 1200 }] }, { log: s => log(s) });
  const prove = fr.results.find(r => r.name === 'prove') || {}, cover = fr.results.find(r => r.name === 'cover') || {};
  // which output failed (assertion line -> check), and the counterexample trace
  let failed = null;
  if (prove.status === 'FAIL' && prove.log) {
    const txt = fs.existsSync(path.join(root, prove.log)) ? fs.readFileSync(path.join(root, prove.log), 'utf8') : '';
    const m = /Assert(?:ion)? failed in \S+?:\s*\S+?\.sv:(\d+)(?:\.\d+)?(?:-(\d+)\.\d+)?/i.exec(txt);
    const line = m ? +(m[2] || m[1]) : null;   // end line of the reported span is the assertion's own line
    const a = m ? (g.asserts.find(x => x.line === line) || g.asserts.find(x => x.line === +m[1])) : null;
    failed = a ? { signal: a.signal, check: a.check, exp: a.exp } : null;
  }
  // cover reachability per bin
  let covers = g.covers.map(c => Object.assign({}, c, { reached: null }));
  if (cover.log && fs.existsSync(path.join(root, cover.log))) {
    const pc = fg.parseCovers(fs.readFileSync(path.join(root, cover.log), 'utf8'));
    covers = g.covers.map(c => Object.assign({}, c, c.line && pc[c.line] ? pc[c.line] : { reached: c.line ? null : undefined }));
  }
  const unreached = covers.filter(c => c.reached === false);
  const verdict = prove.status === 'PASS' ? (unreached.length ? 'warn' : 'pass') : prove.status === 'FAIL' ? 'fail' : 'warn';
  const res = { verdict, bounded: g.bounded || null, small: g.small || null, prove: { status: prove.status, label: prove.label, seconds: prove.duration_s, log: prove.log, trace: prove.trace || null, failed },
    cover: { status: cover.status, seconds: cover.duration_s, log: cover.log, reached: covers.filter(c => c.reached).length, unreached: unreached.length, items: covers },
    asserts: g.asserts, harness: Object.keys(g.files) };
  log(`[formal] prove: ${prove.status}${failed ? ` — ${failed.signal} can differ from the model (${failed.check})` : ''}${prove.trace ? ' — counterexample ' + prove.trace : ''} · cover: ${res.cover.reached} reachable, ${res.cover.unreached} unreachable bin(s)`);
  return res;
}

/* ---------------------------------------------------------------- report page */
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function html(R, root, dir) {
  const toRoot = rel(dir, root);
  const V = { pass: ['pass', 'Pass'], warn: ['warn', 'Review'], fail: ['fail', 'Fail'], skipped: ['mute', 'Skipped'] };
  const pill = v => `<span class="pill t-${(V[v] || V.skipped)[0]}">${(V[v] || V.skipped)[1]}</span>`;
  const a = (href, label) => `<a href="${esc(href)}">${esc(label)}</a>`;
  const src = f => (R.files.find(x => path.basename(x) === path.basename(f)) || f);
  const sec = [];
  const r = R.results;
  if (r.lint) sec.push(`<section><h2>${pill(r.lint.verdict)} Lint <span class="muted">Verilator -Wall</span></h2>${r.lint.state === 'unavailable' ? `<p class="muted">${esc(r.lint.message)}</p>` : `<p>${r.lint.errors} error(s), ${r.lint.warnings} warning(s)</p>${r.lint.items.length ? `<table><thead><tr><th>Where</th><th>Code</th><th>Message</th></tr></thead><tbody>${r.lint.items.map(i => `<tr><td class="mono">${a(`${toRoot}/${src(i.file)}#L${i.line}`, i.file + ':' + i.line)}</td><td class="mono ${i.severity === 'error' ? 'bad' : ''}">${esc(i.code || i.severity)}</td><td>${esc(i.message)}</td></tr>`).join('')}</tbody></table>` : ''}`}</section>`);
  if (r.synth) {
    const s = r.synth;
    sec.push(`<section><h2>${pill(s.verdict)} Synthesis <span class="muted">Yosys generic gates</span></h2>${s.state !== 'done' ? `<p class="bad">${esc(s.message)}</p>${(s.latchSignals || []).length ? '<p>Give every combinational output a value on every path: add the missing <b>else</b> / <b>default</b>, or assign a default at the top of the block.</p>' : ''}${s.log ? `<p class="links">${a(s.log, 'yosys.log')}</p>` : ''}` : `
<div class="kpis"><div><b>${s.cells}</b>cells</div><div><b>${s.flipflops}</b>flip-flops</div><div><b class="${s.latches ? 'bad' : ''}">${s.latches}</b>latches</div><div><b>${s.logicDepth == null ? '–' : s.logicDepth}</b>logic depth</div><div><b class="${s.checkProblems ? 'warnc' : ''}">${s.checkProblems}</b>design problems</div></div>
${s.latchSignals.length ? `<p class="bad">Latch inferred for <span class="mono">${esc(s.latchSignals.join(', '))}</span>. In combinational logic this usually means an <b>if</b> without <b>else</b>, or a <b>case</b> without <b>default</b>.</p>` : ''}
<table><thead><tr><th>Cell type</th><th class="n">Count</th></tr></thead><tbody>${Object.entries(s.byType).sort((x, y) => y[1] - x[1]).map(([t, n]) => `<tr><td class="mono">${esc(t)}</td><td class="n">${n}</td></tr>`).join('')}</tbody></table>
${s.warnings.length ? `<details><summary>${s.warnings.length} synthesis warning(s)</summary><ul>${s.warnings.map(w => `<li class="mono">${esc(w)}</li>`).join('')}</ul></details>` : ''}
<p class="links">${a(s.netlist, 'Gate netlist (Verilog)')} ${a(s.json, 'Netlist JSON (open as schematic)')} ${a(s.log, 'yosys.log')}</p>`}</section>`);
  }
  if (r.lec) sec.push(`<section><h2>${pill(r.lec.verdict)} Logic equivalence <span class="muted">RTL vs gate netlist</span></h2><p>${r.lec.state === 'equivalent' ? 'The netlist is <b>formally equivalent</b> to the RTL.' : r.lec.state === 'different' ? '<span class="bad">The netlist behaves differently from the RTL.</span> Check for X-dependent or simulation-only constructs in the RTL.' : r.lec.state === 'unproven' ? `${r.lec.unproven} of ${r.lec.total} points could not be proven. Gate-level simulation below is the cross-check.` : esc(r.lec.message || r.lec.state)} <span class="muted">${esc(r.lec.method || '')}</span></p></section>`);
  if (r.gls) sec.push(`<section><h2>${pill(r.gls.verdict)} Gate-level simulation <span class="muted">${esc(r.gls.simulator || '')}</span></h2>${r.gls.runs != null ? `<p><b>${r.gls.pass}/${r.gls.runs}</b> tests passed on the gate netlist${r.gls.firstError ? ` — first error: <span class="mono bad">${esc(r.gls.firstError)}</span>` : ''}.</p><p class="links">${a(r.gls.report, 'Open the GLS dashboard')}</p>` : `<p class="muted">${esc(r.gls.message)}</p>`}</section>`);
  if (r.formal) {
    const f = r.formal;
    sec.push(`<section><h2>${pill(f.verdict)} Formal <span class="muted">SymbiYosys · DUT vs reference model, all inputs</span></h2>${!f.prove ? `<p class="muted">${esc(f.message)}</p>` : `
<p><b>Prove:</b> ${f.prove.status === 'PASS' ? 'every checked output <b>equals the model for every input sequence</b> ' + (f.bounded ? `(bounded model check: every input sequence for ${f.bounded} cycles after reset, enough to fill, overflow, drain and wrap the FIFO${f.small ? `; checked on a small instance of the same RTL: ${Object.entries(f.small).map(([k, v]) => k + '=' + v).join(', ')}` : ''}).` : '(unbounded proof by k-induction).') : f.prove.status === 'FAIL' ? `<span class="bad">the DUT can differ from the model</span>${f.prove.failed ? ` on <span class="mono">${esc(f.prove.failed.signal)}</span> (${esc(f.prove.failed.check)}; expected <span class="mono">${esc(f.prove.failed.exp)}</span>)` : ''}.` : esc(f.prove.label || f.prove.status)} <span class="muted">${f.prove.seconds != null ? f.prove.seconds + 's' : ''}</span></p>
${f.prove.trace ? `<p class="links">${a(toRoot + '/' + f.prove.trace, 'Counterexample waveform')} ${a(toRoot + '/' + f.prove.log, 'prove log')}</p>` : f.prove.log ? `<p class="links">${a(toRoot + '/' + f.prove.log, 'prove log')}</p>` : ''}
<p><b>Cover:</b> ${f.cover.reached} coverage bin(s) reachable${f.cover.unreached ? `, <span class="warnc">${f.cover.unreached} unreachable</span>: candidates for a waiver with a formal proof, or a design bug if they should happen` : ''}.</p>
<table><thead><tr><th>Bin</th><th>Condition</th><th>Formal</th></tr></thead><tbody>${f.cover.items.map(c => `<tr><td class="mono">${esc(c.bin)}</td><td>${esc(c.desc)}</td><td>${c.reached === true ? `<span class="pill t-pass">reachable${c.step != null ? ' · step ' + c.step : ''}</span>` : c.reached === false ? '<span class="pill t-fail">unreachable</span>' : `<span class="pill t-mute">${esc(c.skipped || 'n/a')}</span>`}</td></tr>`).join('')}</tbody></table>
<p class="links">${f.harness.map(h => a(toRoot + '/' + h, h)).join(' ')}</p>`}</section>`);
  }
  const vv = V[R.verdict] || V.skipped;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-off — ${esc(R.dut)}</title><style>
:root{--bg:#f3f5f8;--surface:#fff;--fg:#16202b;--muted:#5a6776;--border:#d9dfe6;--pass:#16834a;--fail:#c9303e;--warn:#b06800;--mute:#8793a0;--accent:#2457d6;--font:"Segoe UI",system-ui,sans-serif;--mono:"Cascadia Code",Consolas,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0d1217;--surface:#141b22;--fg:#e3e9ef;--muted:#94a2b0;--border:#26313c;--pass:#40c07c;--fail:#ff6b75;--warn:#f0a43a;--mute:#6f7d8a;--accent:#6f9dff;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 var(--font)}main{max-width:1100px;margin:0 auto;padding:24px;display:grid;gap:18px}
h1{font-size:20px;margin:0}h2{font-size:16px;margin:0 0 10px;display:flex;gap:10px;align-items:center}.muted{color:var(--muted);font-weight:400;font-size:13px}
section{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 18px}p{margin:6px 0}
.mono{font-family:var(--mono);font-size:12.5px}.bad{color:var(--fail)}.warnc{color:var(--warn)}a{color:var(--accent)}.links{display:flex;gap:16px;flex-wrap:wrap}
.pill{font-size:12px;font-weight:600;padding:1px 10px;border-radius:999px}.t-pass{color:var(--pass);background:color-mix(in srgb,var(--pass) 13%,transparent)}.t-fail{color:var(--fail);background:color-mix(in srgb,var(--fail) 13%,transparent)}.t-warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 14%,transparent)}.t-mute{color:var(--mute);background:color-mix(in srgb,var(--mute) 14%,transparent)}
.kpis{display:flex;gap:28px;flex-wrap:wrap;margin:6px 0 10px}.kpis b{display:block;font-size:22px}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}th,td{text-align:left;padding:6px 10px;border-top:1px solid var(--border)}thead th{border-top:0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.n{text-align:right}
.head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}.verdict{font-size:18px;font-weight:700;padding:6px 16px;border-radius:8px}
.checklist{display:flex;gap:10px;flex-wrap:wrap}.checklist span{display:flex;gap:6px;align-items:center}
</style></head><body><main>
<div class="head"><div><h1>Sign-off — ${esc(R.dut)}</h1><div class="muted">${esc(R.id)} · template ${esc(R.template)} · ${esc(R.files.join(', '))} · ${R.seconds}s</div></div><span class="verdict pill t-${vv[0]}">${R.verdict === 'pass' ? 'Ready' : vv[1]}</span></div>
<div class="checklist">${Object.entries(R.results).map(([k, v]) => `<span>${pill(v.verdict)} ${esc({ lint: 'Lint', synth: 'Synthesis', lec: 'Equivalence', gls: 'Gate-level sim', formal: 'Formal' }[k])}</span>`).join('')}</div>
${sec.join('\n')}
</main></body></html>`;
}

module.exports = { run, STEPS };

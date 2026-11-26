'use strict';
/** --waves value -> 'all' | 'fail' | 'none'.  default 'fail' (dvflow.json options.waves: true = all, "fail" or false = fail, "none" = none) */
function wavesModeOf(v, cfgDefault) {
  const s = String(v == null ? '' : v).toLowerCase();
  if (/^(fail|failed|failing|on-?fail(ure)?)$/.test(s)) return 'fail';
  if (s !== '') return /^(1|true|yes|all|always|on)$/.test(s) ? 'all' : 'none';
  if (cfgDefault === true) return 'all';
  if (String(cfgDefault).toLowerCase() === 'none') return 'none';
  return 'fail';
}
/* DV flow engine: generate, build, run, regress, rerun, triage, results, JUnit/JSON, testplan update. */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const tb = require('./tbgen');
const sim = require('./sim');
const plan = require('./testplan');

const read = f => fs.readFileSync(f, 'utf8');
const ENGINE_VERSION = '0.5.1';
const mkdir = d => fs.mkdirSync(d, { recursive: true });
const rel = (from, to) => path.relative(from, to).replace(/\\/g, '/');
const nowId = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

function loadConfig(root) {
  const f = path.join(root, 'dvflow.json');
  if (!fs.existsSync(f)) throw new Error('dvflow.json not found in ' + root + ' — run "Select DUT" first.');
  const cfg = tb.withDefaults(JSON.parse(read(f).replace(/^\uFEFF/, '')));
  // the same source listed twice would be compiled twice ("module already declared")
  if (cfg.dut && Array.isArray(cfg.dut.files)) cfg.dut.files = [...new Set(cfg.dut.files.map(x => String(x).replace(/\\/g, '/')))];
  return cfg;
}

/* ------------------------------------------------------------------ generation (with preview) */
function plannedFiles(root, cfg, opts) {
  opts = opts || {};
  const files = [];
  const add = (p, content, opt) => { const abs = path.join(root, p); const exists = fs.existsSync(abs); files.push({ path: p, abs, content, exists, changed: !exists || read(abs) !== content, ...opt }); };
  const vhdl = (cfg.language || 'sv') === 'vhdl';
  const dut = vhdl ? null : tb.resolveDut(cfg, root, {}, read);
  const model = vhdl ? null : tb.buildModel(cfg, dut.ports, dut.paramValues);
  const mode = vhdl ? 'vhdl' : (opts.mode || cfg.mode || 'lightweight');
  // modes: lightweight | uvm | both (lightweight + uvm) | cocotb | all (lightweight + uvm + cocotb)
  if (mode === 'cocotb' || mode === 'all') {
    for (const [f, c] of Object.entries(require('./cocotbgen').generate(root, cfg).files)) add(f, c, { cocotb: true });
  }
  if (mode !== 'uvm' && mode !== 'vhdl' && mode !== 'cocotb') {
    const tbRel = `tb/tb_${cfg.dut.top}.sv`;
    add(tbRel, tb.genTb(cfg, model, dut, {}));
    if (cfg.options.assertions) add(`tb/sva_${cfg.dut.top}.sv`, tb.genSva(cfg, model, dut));
    add('tb/files.f', tb.fileList(cfg, root, tbRel));
  }
  if (mode === 'uvm' || mode === 'both' || mode === 'all') {
    const uvmgen = require('../uvmgen');
    const C = tb.uvmCustom(cfg, model);
    const r = uvmgen.generate({ name: cfg.dut.top, dut: Object.assign({}, dut.mod, { ports: dut.ports, params: Object.entries(cfg.dut.params).map(([k, v]) => ({ name: k, value: String(v) })) }), active: true,
      features: { coverage: cfg.options.functional_coverage, scoreboard: true, assertions: cfg.options.assertions, questa: true },
      rtlFiles: cfg.dut.files.map(f => rel(path.join(root, 'uvm'), path.join(root, f))),
      custom: { seqs: C.seqs, tests: C.tests, predict: C.predict, modelDecls: C.modelDecls, closure: C.closure } });
    for (const [f, c] of Object.entries(r.files)) add('uvm/' + f, c, { uvm: true });
  }
  add('Makefile', tb.makefile(cfg));
  const w = tb.wrappers(opts.runtime);
  add('dvflow.cmd', w.cmd);
  add('dvflow.sh', w.sh, { mode: 0o755 });
  // test plan: never overwritten — merged so engineer-authored content survives
  const tpPath = require('./layout').planYaml(root);   // an old-layout plan (project root) is merged and moved to testplan/
  if (model) add('testplan/testplan.yaml', plan.mergePlan(fs.existsSync(tpPath) ? read(tpPath) : null, cfg, model));
  // vendored engine so make / CI work without the extension
  if (opts.engineSrc) {
    const list = ['dv/cli.js', 'dv/runner.js', 'dv/tbgen.js', 'dv/templates.js', 'dv/sim.js', 'dv/testplan.js', 'dv/report.js', 'dv/planxlsx.js', 'dv/formal.js', 'dv/uvmrun.js', 'dv/qcov.js', 'dv/container.js', 'dv/vcov.js', 'dv/mutate.js', 'dv/external.js', 'dv/cocotbgen.js', 'dv/cocotbrun.js', 'dv/tools.js', 'dv/synth.js', 'dv/formalgen.js', 'dv/signoff.js', 'dv/demo.js', 'dv/seeds.js', 'dv/layout.js', 'hdlparse.js', 'fsm.js', 'uvmgen.js', 'vplan.js', 'coverage.js', 'xlsx.js'];
    for (const f of list) {
      const src = path.join(opts.engineSrc, f);
      if (fs.existsSync(src)) add('.dvflow/' + (f.startsWith('dv/') ? 'engine/' + f.slice(3) : f), read(src), { engine: true });
    }
  }
  files.root = root; files.top = cfg.dut.top;
  return { files, model, dut };
}

function writeFiles(files) {
  for (const f of files) {
    if (!f.changed) continue;
    mkdir(path.dirname(f.abs));
    fs.writeFileSync(f.abs, f.content);
    if (f.mode) { try { fs.chmodSync(f.abs, f.mode); } catch (e) { /* windows */ } }
  }
  const L = require('./layout');
  // project root and DUT name: from the list itself, so a filtered copy of it (the extension's pick list) works too
  const any = files.find(f => f.abs && f.path);
  const root = files.root || (any ? any.abs.slice(0, any.abs.length - any.path.length).replace(/[\\/]+$/, '') : null);
  const pkg = files.find(f => /^uvm\/[^/]+_pkg\.sv$/.test(f.path));
  const top = files.top || (pkg ? pkg.path.slice(4, -7) : null);
  if (root) {
    if (L.retireOldPlan(root)) files.movedPlan = true;                                         // old layout: plan now in testplan/
    if (top && files.some(f => f.changed && /^uvm\//.test(f.path))) files.retiredUvm = L.retireFlatUvm(root, top);
  }
  // the Excel test plan is created together with testplan.yaml (and refreshed whenever the plan is regenerated)
  const tp = files.find(f => f.changed && f.path === 'testplan/testplan.yaml');
  if (tp) { try { const x = require('./planxlsx').writePlan(root || path.dirname(path.dirname(tp.abs))); if (x) files.xlsx = x; } catch (e) { files.xlsxError = e.message; } }
}

/* ------------------------------------------------------------------ processes */
function runProc(c, logFile, timeoutMs, token, env, simId) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const chunks = [];
    const write = d => chunks.push(Buffer.isBuffer(d) ? d.toString('utf8') : String(d));
    // flush through the redactor so licence values never reach the saved logs
    const flush = () => { const txt = sim.redact(chunks.splice(0).join(''), simId); if (txt) fs.appendFileSync(logFile, txt); };
    write(`$ ${[c.cmd, ...c.args].map(a => /\s/.test(a) ? `"${a}"` : a).join(' ')}\n# cwd: ${c.cwd}\n`);
    if (c.container || String(c.cmd).startsWith('ctr:')) {
      try { c = require('./container').wrap(c); write(`# in container: ${c.display}\n`); env = process.env; }
      catch (e) { write(`\n# container toolchain: ${e.message}\n`); flush(); return resolve({ code: -1, error: 'ENOENT: container toolchain unavailable — ' + e.message, ms: 0 }); }
    }
    let p;
    try { p = cp.spawn(c.cmd, c.args, { cwd: c.cwd, windowsHide: true, env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { write(`\n# failed to start: ${e.message}\n`); flush(); return resolve({ code: -1, error: e.message, ms: 0 }); }
    let killedBy = null, spawnError = null;
    const kill = why => { if (killedBy) return; killedBy = why; try { if (c.onKill) c.onKill(); } catch (e) { /* best effort */ } try { p.kill(); } catch (e) { /* gone */ } };
    const timer = timeoutMs ? setTimeout(() => kill('timeout'), timeoutMs) : null;
    const sub = token && token.onCancellationRequested ? token.onCancellationRequested(() => kill('cancelled')) : null;
    const poll = token && !token.onCancellationRequested ? setInterval(() => { if (token.isCancellationRequested) kill('cancelled'); }, 200) : null;
    const periodic = setInterval(flush, 500);    // partial logs survive cancellation / crashes
    p.stdout.on('data', write);
    p.stderr.on('data', write);
    p.on('error', e => { spawnError = e.code === 'ENOENT' ? `ENOENT: ${c.cmd} not found` : e.message; write(`\n# process error: ${spawnError}\n`); });
    p.on('close', code => {
      if (timer) clearTimeout(timer);
      if (sub) sub.dispose();
      if (poll) clearInterval(poll);
      clearInterval(periodic);
      if (killedBy) write(`\n# DVFLOW: process stopped (${killedBy}) after ${Date.now() - t0} ms — partial log preserved\n`);
      flush();
      resolve({ code, killedBy, ms: Date.now() - t0, error: spawnError });
    });
  });
}

/* ------------------------------------------------------------------ log parsing + classification */
function parseSimLog(text) {
  const lines = text.split(/\r?\n/);
  const r = { result: null, errors: 0, checks: 0, reason: '', mismatches: [], missing: [], timeout: null, scenarios: {}, bins: {}, asserts: [], license: false, licenseLines: [], firstError: null };
  lines.forEach((l, i) => {
    let m;
    if ((m = /DVFLOW_RESULT (PASS|FAIL) errors=(\d+) checks=(\d+)(?: reason=(\S+))?/.exec(l))) { r.result = m[1]; r.errors = +m[2]; r.checks = +m[3]; r.reason = m[4] || ''; }
    else if ((m = /DVFLOW_MISMATCH t=(\d+)\S* test=(\S+) seed=(-?\d+) scenario=(\S+) signal=(\S+) expected=(\S+) actual=(\S+) reason=(.*?) inputs: ?(.*)$/.exec(l))) r.mismatches.push({ line: i + 1, time: +m[1], test: m[2], seed: +m[3], scenario: m[4], signal: m[5], expected: m[6], actual: m[7], reason: m[8].trim(), inputs: m[9].trim() });
    else if ((m = /DVFLOW_MISSING t=(\d+) .*?scenario=(\S+) expected_transactions=(\d+) received=(\d+) missing=(\d+) first_missing_data=(\S+)/.exec(l))) r.missing.push({ line: i + 1, time: +m[1], scenario: m[2], expected: +m[3], received: +m[4], missing: +m[5], data: m[6] });
    else if ((m = /DVFLOW_TIMEOUT t=(\d+) .*?scenario=(\S+)/.exec(l))) r.timeout = { line: i + 1, time: +m[1], scenario: m[2] };
    else if ((m = /DVFLOW_SCENARIO (\S+) ran=(\d+) checks=(\d+) fails=(\d+)/.exec(l))) r.scenarios[m[1]] = { ran: +m[2], checks: +m[3], fails: +m[4] };
    else if ((m = /DVFLOW_BIN (\S+) (\d+)/.exec(l))) r.bins[m[1]] = +m[2];
    else if (/\*\* Error: .*Assertion|Offending '|\(assertion (error|failure)\)|assertion (error|failure)/i.test(l)) r.asserts.push({ line: i + 1, text: l.trim() });
  });
  const dg = sim.diagnose(text);
  if (dg && dg.kind === 'license') { r.license = true; r.licenseLines = dg.lines; r.licenseLine = dg.line; }
  return r;
}

function classify(run, build) {
  if (build && build.blocked && build.failStage === 'unsupported') return { kind: 'unsupported', label: 'Unsupported feature', stage: 'unsupported' };
  if (build && build.blocked) return { kind: 'installation', label: 'Missing simulator executable', stage: 'installation' };
  if (build && build.license) return { kind: 'license', label: 'License checkout failed', stage: build.failStage || 'compile' };
  if (build && build.failed) return { kind: 'compile', label: build.failStage === 'elaborate' ? 'Elaboration issue' : build.failStage === 'configuration' ? 'Configuration issue' : 'Compile issue', stage: build.failStage || 'compile' };
  if (run.parsed && run.parsed.license) return { kind: 'license', label: 'License checkout failed', stage: 'simulate' };
  if (run.procError) return { kind: /ENOENT/.test(run.procError) ? 'installation' : 'tool', label: /ENOENT/.test(run.procError) ? 'Missing simulator executable' : 'Simulator issue', stage: /ENOENT/.test(run.procError) ? 'installation' : 'simulate' };
  if (run.killedBy === 'timeout' || run.parsed.timeout) return { kind: 'timeout', label: 'Timeout', stage: 'test' };
  if (run.parsed.asserts.length) return { kind: 'assertion', label: 'Assertion failure', stage: 'test' };
  if (run.parsed.missing.length) return { kind: 'missing', label: 'Missing transaction', stage: 'test' };
  if (run.parsed.mismatches.length) return { kind: 'mismatch', label: 'Scoreboard mismatch', stage: 'test' };
  return { kind: 'unknown', label: 'Unknown', stage: 'test' };
}

function statusOf(run, build) {
  if (build && build.failed) return build.license ? 'LICENSE' : 'ERROR';
  if (run.killedBy === 'cancelled') return 'CANCELLED';
  if (run.killedBy === 'timeout') return 'TIMEOUT';
  if (run.parsed.license) return 'LICENSE';
  if (run.procError) return 'ERROR';
  const p = run.parsed;
  if (p.result === 'PASS' && run.code === 0) return 'PASS';
  if (p.result === 'FAIL') return p.timeout ? 'TIMEOUT' : 'FAIL';
  if (p.result === 'PASS' && run.code !== 0) return 'FAIL';           // explicit pass but abnormal exit: trust the evidence of failure
  if (p.mismatches.length || p.asserts.length) return 'FAIL';
  return 'INCOMPLETE';
}

function nextAction(cls, x) {
  const make = `make retry` + (x.simId ? ` SIM=${x.simId}` : '');
  switch (cls.kind) {
    case 'installation': return `${sim.fixHint(x.simId)} Then: make check-tools SIM=${x.simId} && ${make}`;
    case 'license': return `License checkout failed during ${cls.stage}. Check the per-user license setting ("DV: Configure Simulators" or the "license" block of ${sim.USER_FILE}) or contact your license administrator. Then: make check-tools SIM=${x.simId} && ${make}`;
    case 'unsupported': return `${(x.b.errors[0] || {}).message}. Select another simulator (SIM=...); run "make capabilities" to see which ones support it.`;
    case 'compile': { const e = (x.b.errors || [])[0]; return e && e.file ? `Fix ${e.file}:${e.line} (${e.message}); see build.log line ${e.lineInLog || 1}. Then: ${make}` : `See the first error in build.log. Then: ${make}`; }
    case 'tool': return `The simulator stopped unexpectedly; see sim.log. Then: ${make}`;
    default: return `Open triage.md for the first mismatch; reproduce with: ${sim.IS_WIN ? '.\\dvflow.cmd ' : './dvflow.sh '}${x.rerunArgs} --waves 1`;
  }
}

/* ------------------------------------------------------------------ helpers */
function gitRev(root) {
  try {
    const r = cp.spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (r.status === 0) { const d = cp.spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true }); return r.stdout.trim() + (d.stdout && d.stdout.trim() ? '+dirty' : ''); }
  } catch (e) { /* no git */ }
  return 'unavailable';
}

function quoteArg(a) { return /[\s"]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a; }
function cmdLine(c) { return [c.cmd, ...c.args].map(quoteArg).join(' '); }

function loadWaivers(root) {
  const f = path.join(root, 'waivers.yaml');
  if (!fs.existsSync(f)) return [];
  try {
    const y = require('../vplan').parseYaml(read(f));
    const today = new Date().toISOString().slice(0, 10);
    return (y.waivers || []).filter(Boolean).map(w => ({ bin: String(w.bin || ''), rationale: String(w.rationale || ''), reviewer: String(w.reviewer || ''), expires: w.expires ? String(w.expires) : '', expired: !!(w.expires && String(w.expires) < today) }));
  } catch (e) { return []; }
}

function previousRun(root, runId) {
  const dir = path.join(root, 'runs');
  if (!fs.existsSync(dir)) return null;
  const ids = fs.readdirSync(dir).filter(d => d < runId && fs.existsSync(path.join(dir, d, 'results.json'))).sort();
  if (!ids.length) return null;
  try { return JSON.parse(read(path.join(dir, ids[ids.length - 1], 'results.json'))); } catch (e) { return null; }
}

/* ------------------------------------------------------------------ triage */
function triage(ctx) {
  const { r, cls, build, root, failDir, cfg, model } = ctx;
  const L = [];
  const p = r.parsed;
  L.push(`# Triage — ${r.test} / seed ${r.seed} / config ${r.config}`, '');
  L.push(`| | |`, `|---|---|`, `| Run | ${ctx.runId} |`, `| Status | **${r.status}** |`, `| Classification | **${cls.label}** |`, `| Simulator | ${ctx.simLabel} ${ctx.simVersion} |`, `| Seed | ${r.seed} |`, `| DUT parameters | ${JSON.stringify(r.params)} |`, `| Source revision | ${ctx.rev} |`, '');
  L.push('## First actionable error', '');
  const logLink = (file, line) => `[${file}:${line}](${file}#L${line})`;
  const dutFile = path.join(root, cfg.dut.files[0]);
  const portLine = sig => { try { const t = read(dutFile).split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')); const drv = new RegExp('(\\bassign\\s+[^;]*\\b' + sig + '\\b|\\b' + sig + '\\s*(\\[[^\\]]*\\])?\\s*<?=(?!=)|\\{[^}]*\\b' + sig + '\\b[^}]*\\}\\s*=)'); let k = t.findIndex(l => drv.test(l)); if (k < 0) k = t.findIndex(l => new RegExp('\\b(output|input|inout)\\b[^;]*\\b' + sig + '\\b').test(l)); if (k < 0) k = t.findIndex(l => new RegExp('\\b' + sig + '\\b').test(l)); return k >= 0 ? k + 1 : null; } catch (e) { return null; } };
  const relDut = rel(failDir, dutFile);
  L.push(`**Failing stage:** ${cls.stage || r.stage || 'test'}  \n**Next action:** ${r.nextAction || ''}`, '');
  if (cls.kind === 'license') {
    const ll = build.license ? build.licenseLines : (p.licenseLines || []);
    L.push('License checkout failed (vendor diagnostic, license details redacted):', '', '```', ...ll, '```', '', `Log: ${logLink(build.license ? 'build.log' : 'sim.log', build.license ? build.licenseLine || 1 : p.licenseLine || 1)}`, '', 'This is **not** a test failure: no design behaviour was checked.', '');
  } else if (cls.kind === 'installation') {
    L.push(`Simulator executable missing: ${(build.errors[0] || {}).message || r.procError || ''}`, '');
  } else if (cls.kind === 'unsupported') {
    L.push((build.errors[0] || {}).message || 'Unsupported feature.', '');
  } else if (cls.kind === 'compile') {
    const e = (build.errors || [])[0];
    L.push(e ? `Compile error at **${e.file}:${e.line}**: \`${e.message}\`` : 'The build failed; see build.log.', '', `Log: ${logLink('build.log', e ? e.lineInLog || 1 : 1)}`, '');
  } else if (cls.kind === 'timeout') {
    L.push(`The run did not finish within the timeout${p.timeout ? ` (watchdog fired at t=${p.timeout.time} ns in scenario ${p.timeout.scenario})` : ' (process stopped by the runner)'}.`, '', `Log: ${logLink('sim.log', p.timeout ? p.timeout.line : 1)}`, '');
  } else if (cls.kind === 'missing') {
    const x = p.missing[0];
    L.push(`**${x.missing} expected transaction(s) never arrived** (expected ${x.expected}, received ${x.received}) in scenario ${x.scenario}; first missing data = ${x.data}, reported at t=${x.time} ns.`, '', `Log: ${logLink('sim.log', x.line)}`, '');
  } else if (cls.kind === 'mismatch') {
    const x = p.mismatches[0];
    const pl = portLine(x.signal);
    L.push(`First mismatch at **t=${x.time} ns**, scenario **${x.scenario}**, signal **${x.signal}**:`, '', '| expected | actual | inputs |', '|---|---|---|', `| \`${x.expected}\` | \`${x.actual}\` | \`${x.inputs}\` |`, '', `Log: ${logLink('sim.log', x.line)}${pl ? ` · RTL: [${path.basename(dutFile)}:${pl}](${relDut}#L${pl})` : ''}`, '');
    if (p.mismatches.length > 1) L.push(`${p.mismatches.length} mismatches reported (the testbench prints at most ${cfg.options.max_reported_mismatches}); ${p.errors} errors in total.`, '');
  } else if (cls.kind === 'assertion') {
    L.push(`Assertion failure: \`${p.asserts[0].text}\``, '', `Log: ${logLink('sim.log', p.asserts[0].line)}`, '');
  } else if (cls.kind === 'tool') {
    L.push('The simulator could not run (license, missing executable or crash). See sim.log.', '');
  } else {
    L.push('No explicit result or error line was found; the log may be truncated.', '');
  }
  L.push('## Hypotheses (unconfirmed)', '');
  const hyp = [];
  if (cls.kind === 'mismatch') {
    const x = p.mismatches[0];
    const ex = parseInt(x.expected, 16), ac = parseInt(x.actual, 16);
    if (cfg.template === 'counter' || cfg.template === 'updown_counter') {
      if (ex === 0 && ac === (model.N || 0) + 1) hyp.push(['The RTL wraps one count late (off-by-one at the terminal count N).', `Waveform around t=${x.time} ns shows ${model.roles.count} going ${model.N} → ${model.N + 1} instead of ${model.N} → 0; check the terminal-count comparison in the RTL.`]);
      if (ac === 0 && ex === model.N) hyp.push(['The RTL wraps one count early (compares against N-1).', `Look for a count == N-1 comparison; the waveform shows the counter never reaching ${model.N}.`]);
    }
    if (cfg.template === 'adder' && x.signal === (model.roles.cout || '')) hyp.push(['The carry-out is computed from the wrong bit or without the carry-in.', `Expected carry ${x.expected} for inputs ${x.inputs}; compare the RTL carry expression with a+b${model.roles.cin ? '+cin' : ''} at width W+1.`]);
    if (cfg.template === 'adder' && x.signal === model.roles.sum) hyp.push(['The sum logic is wrong for these operands (e.g. an XOR instead of an add, or a truncated operand).', `Re-run SC exhaustive with waves; every failing operand pair should share the faulty bit position.`]);
    hyp.push(['The RTL does not implement the approved behaviour for this scenario.', `Re-run with waves (rerun.cmd --waves) and inspect ${x.signal} at t=${x.time} ns against the reference model.`]);
    hyp.push(['The behaviour spec in dvflow.json (reference model) disagrees with the intended design.', 'Confirm the requirement in testplan/testplan.yaml; if the spec is wrong, edit "behavior" and regenerate the testbench.']);
    if (model.seq) hyp.push(['Latency or reset timing differs from the configuration.', 'If the actual value equals the expected value of the previous/next cycle, adjust latency/clock edge in dvflow.json.']);
  } else if (cls.kind === 'missing') {
    hyp.push(['The DUT drops a transaction (for example when beats arrive back-to-back).', 'Check the waveform for an input beat without a matching output beat; the scenario that dropped it is recorded above.']);
    hyp.push(['The configured latency is too short, so the drain period ended before the output appeared.', 'Increase behavior.latency in dvflow.json and rerun; if the beat appears later, it is a latency mismatch, not a drop.']);
  } else if (cls.kind === 'compile') hyp.push(['A syntax or elaboration error in the RTL or the generated testbench.', 'The compiler message above names the file and line; fix it and rebuild.']);
  else if (cls.kind === 'timeout') hyp.push(['The DUT or testbench waits on a condition that never happens, or the timeout is too small for the iteration count.', 'Re-run with waves; if activity continues normally, raise options.timeout_ns.']);
  else if (cls.kind === 'license') hyp.push(['The license server/file is unreachable, invalid for this host, or the required feature is not licensed.', 'Run make check-tools SIM=<sim>; it repeats the checkout in a minimal batch simulation and shows the vendor diagnostic.']);
  else if (cls.kind === 'installation') hyp.push(['The simulator path is not configured or points to the wrong folder.', 'Run make check-tools SIM=<sim>; it lists every tool it looked for and where.']);
  else if (cls.kind === 'tool') hyp.push(['The simulator license or installation is unavailable on this machine.', 'Run "make capabilities" / Show Simulator Capabilities; check the license environment variables.']);
  else hyp.push(['The simulation ended without a result line.', 'Check the end of sim.log for a crash or $finish from DUT code.']);
  hyp.forEach(([h, e], i) => L.push(`${i + 1}. **Hypothesis:** ${h}  \n   *Evidence that would confirm it:* ${e}`));
  L.push('', '## Reproduce', '', 'From the project root:', '', '```', ctx.rerunCli, '```', '', 'Raw simulator commands: see `command.txt`. Waveforms: ' + (r.waves ? '`waves.vcd` in this folder' + (r.wavesOnFailure ? ' (the failing test was re-run once with waves, same seed).' : '.') : 'rerun with `--waves 1` (or `rerun.cmd` / `rerun.sh`, which enable waves).'), '');
  L.push('## Artifacts', '', '- [sim.log](sim.log)' + (fs.existsSync(path.join(failDir, 'build.log')) ? '\n- [build.log](build.log)' : '') + '\n- [command.txt](command.txt)\n- [config.json](config.json)\n- [rerun.cmd](rerun.cmd) / [rerun.sh](rerun.sh)', '');
  return L.join('\n');
}

/* ------------------------------------------------------------------ regression */
async function regress(root, o) {
  o = Object.assign({ log: () => {} }, o);
  const cfg = loadConfig(root);
  // "custom" template: refuse to run while the reference model is still the generated placeholder
  if (cfg.template === 'custom') {
    const ph = Object.entries((cfg.behavior && cfg.behavior.checks) || {}).filter(([, v]) => /\/\*\s*expected .* from in_\*/.test(String(v))).map(([k]) => k);
    if (ph.length) throw Object.assign(new Error(`dvflow.json uses the "custom" template but the reference model is not written yet (behavior.checks for ${ph.join(', ')} are placeholders), so every check would fail. Either write the expected values in dvflow.json → behavior.checks (and model_step for state), or run "DV: Select DUT" again and pick the template that matches the DUT (e.g. "adder"). Then regenerate the testbench.`), { exitCode: 3 });
  }
  if (o.bug) {
    if (!cfg.bug_injection || !cfg.bug_injection.files) throw Object.assign(new Error('This project has no "bug_injection" section in dvflow.json.'), { exitCode: 3 });
    cfg.dut.files = cfg.bug_injection.files;
    o.runId = o.runId || nowId() + '-bug';
  }
  // mutation testing: compile mutated copies of the DUT instead of the real files (never touches the plan or dashboards)
  if (o.dutFiles) cfg.dut.files = o.dutFiles;
  // o.kind (e.g. 'gls'): a tagged run with its own dashboard badge; never rewrites the RTL test plan or "latest"
  const quiet = !!(o.bug || o.mutant || o.kind);
  const simId = o.sim || cfg.simulator || 'icarus';
  const adapter = sim.ADAPTERS[simId];
  if (!adapter) throw Object.assign(new Error(`Unknown simulator '${simId}'. Use one of: ${Object.keys(sim.ADAPTERS).join(', ')}`), { exitCode: 3 });
  const ov = (o.override || {})[simId] || {};
  // first run without local tools: download the Docker image (once, with progress) before choosing the simulator
  try { await require('./container').prepare({ sims: [simId], override: o.override, log: s => o.log(s), token: o.token }); }
  catch (e) { throw Object.assign(new Error('Docker toolchain: ' + e.message), { exitCode: 2 }); }
  const det = sim.detect(simId, ov);
  const log = s => o.log(sim.redact(s, simId));
  const vhdl = (cfg.language || 'sv') === 'vhdl';
  let runId = o.runId || (nowId() + (o.kind ? '-' + o.kind : ''));
  if (!o.runId) { const base = runId; let k = 2; while (fs.existsSync(path.join(root, 'runs', runId))) runId = `${base}-${k++}`; }   // never reuse a run directory
  const runDir = path.join(root, 'runs', runId);
  mkdir(runDir);
  const alias = t => (cfg.tests.includes(t) ? t : (t.startsWith(cfg.dut.top + '_') && cfg.tests.includes(t.slice(cfg.dut.top.length + 1)) ? t.slice(cfg.dut.top.length + 1) : t));
  const suiteTests = (o.jobs && o.jobs.length ? [...new Set(o.jobs.map(j => j.test))] : o.tests && o.tests.length ? o.tests : (cfg.suites[o.suite || 'full'] || cfg.tests)).map(alias);
  const seeds = (o.jobs && o.jobs.length ? [...new Set(o.jobs.map(j => Number(j.seed)))] : o.seeds && o.seeds.length ? o.seeds : cfg.seeds).map(Number);
  const configs = (o.configs && o.configs.length ? cfg.configs.filter(c => o.configs.includes(c.name)) : cfg.configs);
  // waveforms: 'all' (every run), 'fail' (only failing runs: rerun once with +WAVES, same seed; the default), 'none'
  const wavesMode = wavesModeOf(o.waves, cfg.options.waves);
  const waves = wavesMode === 'all';
  const caps = det.caps || adapter.caps('');
  const yes = f => /^yes/.test(String(caps[f] || ''));
  const mode = covMode(o.cov, cfg.options.code_coverage ? 'both' : 'functional');
  const covReq = mode === 'both' || mode === 'code';
  const cov = covReq && yes('code_coverage');
  const assertions = cfg.options.assertions && yes('assertions');
  // requested features the selected simulator cannot provide: say so, name an alternative, keep running without them
  const unsupported = [];
  const need = (on, feature, what) => { if (on && !yes(feature)) unsupported.push({ feature, what, simulator: adapter.label, state: String(caps[feature]), alternatives: sim.alternatives(feature, simId, o.override) }); };
  need(covReq, 'code_coverage', 'code coverage');
  need(cfg.options.assertions, 'assertions', 'concurrent SVA assertions');
  need(vhdl, 'vhdl', 'VHDL');
  need(!vhdl, 'lightweight', 'SystemVerilog testbench');
  const rev = gitRev(root);
  const meta = {
    runId, started: new Date().toISOString(), root, dut: cfg.dut.top, template: cfg.template, language: vhdl ? 'vhdl' : 'sv',
    simulator: simId, simRequested: simId, simLabel: adapter.label, simVersion: det.version || '', simAvailable: det.available, simReason: det.reason || '', simSource: det.source || '',
    rev, suite: o.suite || (o.tests ? 'custom' : 'full'), tests: suiteTests, seeds, configs: configs.map(c => c.name), waves, wavesMode,
    coverage: { code: cov, functional: (mode === 'both' || mode === 'functional') && cfg.options.functional_coverage !== false, mode, assertions }, capabilities: caps, unsupported,
    scenarioFilter: o.scenario || null, host: require('os').hostname(),
    ...(o.kind ? { kind: o.kind, testbench: o.kind === 'gls' ? 'Gate-level simulation (Yosys netlist)' : o.kind } : {}),
    request: { sim: simId, suite: o.suite || null, tests: suiteTests, seeds, configs: configs.map(c => c.name), waves: wavesMode === 'fail' ? 'fail' : waves ? 1 : 0, cov: covReq, scenario: o.scenario || null, jobs: o.jobs || null }
  };
  fs.writeFileSync(path.join(runDir, 'config.json'), JSON.stringify(cfg, null, 2));
  const runs = [];
  const builds = {};
  log(`== DV run ${runId} (dvflow engine ${ENGINE_VERSION}): ${cfg.dut.top} on ${adapter.label} ${det.version || ''} — tests [${suiteTests.join(', ')}] x seeds [${seeds.join(', ')}] x configs [${configs.map(c => c.name).join(', ')}]`);
  if (!det.available) { log(`!! STAGE installation: ${det.reason}`); log(`   NEXT: ${sim.fixHint(simId)}`); }
  for (const u of unsupported) log(`!! UNSUPPORTED: ${u.what} is ${u.state} on ${u.simulator}${u.alternatives.length ? `; supported by ${u.alternatives.join(', ')}` : '; no other configured simulator supports it'} — continuing without it`);
  const token = o.token;
  const env = sim.licenseEnv(simId, ov);
  for (const c of configs) {
    if (token && token.isCancellationRequested) break;
    const bdir = path.join(runDir, 'build', c.name);
    mkdir(bdir);
    const b = { config: c.name, params: Object.assign({}, cfg.dut.params, c.params), dir: bdir, failed: false, errors: [], commands: [], failStage: null };
    builds[c.name] = b;
    if (!det.available) { b.failed = true; b.blocked = true; b.failStage = 'installation'; b.errors = [{ message: det.reason }]; continue; }
    if (vhdl ? !yes('vhdl') : !yes('lightweight')) { b.failed = true; b.blocked = true; b.failStage = 'unsupported'; b.errors = [{ message: `${vhdl ? 'VHDL' : 'SystemVerilog testbenches'} not supported by ${adapter.label}` }]; continue; }
    let model;
    try {
      const stage = f => {   // sources saved with a UTF-8 BOM break some simulators: compile a stripped copy
        const abs = path.resolve(root, f);
        const buf = fs.readFileSync(abs);
        if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
          const staged = path.join(bdir, 'src', path.basename(abs));
          mkdir(path.dirname(staged));
          fs.writeFileSync(staged, buf.slice(3));
          fs.appendFileSync(path.join(bdir, 'build.log'), `# DVFLOW: ${f} starts with a UTF-8 byte-order mark; compiling a BOM-free copy. Save it as UTF-8 without BOM to avoid this.\n`);
          return staged;
        }
        return abs;
      };
      let ctx;
      if (vhdl) {
        ctx = { root, outDir: bdir, t: det.tools, cov, vhdl: true, files: cfg.dut.files.map(stage), tests: suiteTests, vhdlStd: cfg.vhdl_std || '08' };
      } else {
        const dut = tb.resolveDut(cfg, root, c.params, read);
        model = tb.buildModel(cfg, dut.ports, dut.paramValues);
        const tbFile = path.join(bdir, `tb_${cfg.dut.top}.sv`);
        fs.writeFileSync(tbFile, tb.genTb(cfg, model, dut, c.params));
        if (assertions) fs.writeFileSync(path.join(bdir, `sva_${cfg.dut.top}.sv`), tb.genSva(cfg, model, dut));
        // o.compileFiles: compile something else than the RTL (the gate-level netlist) with the RTL's testbench
        // paths relative to the project (every compile runs there): a folder name with spaces above the project
        // then never reaches the simulator's file-list parser, which splits on whitespace
        const relp = p => { const r = path.relative(root, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p; };
        const fl = [...cfg.dut.incdirs.map(d => '+incdir+' + relp(path.resolve(root, d))), ...(o.compileFiles || cfg.dut.files).map(f => relp(stage(f))), ...(assertions ? [relp(path.join(bdir, `sva_${cfg.dut.top}.sv`))] : []), relp(tbFile)].map(x => x.replace(/\\/g, '/'));
        fs.writeFileSync(path.join(bdir, 'files.f'), fl.join('\n') + '\n');
        b.model = model;
        ctx = { root, outDir: bdir, tbTop: `tb_${cfg.dut.top}`, fileList: path.join(bdir, 'files.f'), t: det.tools, cov, assertions, container: !!det.container };
      }
      for (const cmd of adapter.build(ctx)) {
        b.commands.push(sim.redact(cmdLine(cmd), simId));
        log(`[build ${c.name}] ${cmd.stage}: ${cmdLine(cmd)}${det.container ? '   [container]' : ''}`);
        if (det.container) cmd.container = true;
        const res = await runProc(cmd, path.join(bdir, 'build.log'), (o.buildTimeoutS || 600) * 1000, token, env, simId);
        if (res.error && /ENOENT/.test(res.error)) { b.failed = true; b.blocked = true; b.failStage = 'installation'; b.errors = [{ message: `${path.basename(cmd.cmd)} could not be started (${cmd.cmd})` }]; break; }
        if (res.code !== 0) { b.failed = true; b.failStage = cmd.stage; break; }
      }
    } catch (e) { b.failed = true; b.failStage = b.failStage || 'configuration'; b.errors = [{ message: e.message }]; fs.appendFileSync(path.join(bdir, 'build.log'), '\n# DVFLOW: ' + e.message + '\n'); }
    const blog = fs.existsSync(path.join(bdir, 'build.log')) ? read(path.join(bdir, 'build.log')) : '';
    const dg = sim.diagnose(blog);
    if (dg && dg.kind === 'license') { b.failed = true; b.license = true; b.licenseLines = dg.lines; b.licenseLine = dg.line; }
    const errs = b.license ? [] : sim.compileErrors(blog);
    errs.forEach(e => { const k = blog.split(/\r?\n/).findIndex(l => l.includes(`${e.file}:${e.line}`) || l.includes(`${e.file}(${e.line})`)); e.lineInLog = k + 1; });
    if (errs.length) b.errors = errs.concat(b.errors.filter(e => !e.file));
    if (errs.some(e => e.severity === 'error')) b.failed = true;
    if (b.failed && !b.blocked && !b.license && !b.errors.length) { const x = sim.diagnose(blog); if (x) b.errors = [{ message: x.lines[0], lineInLog: x.line }]; }
    log(`[build ${c.name}] ${b.failed ? `FAILED at stage ${b.license ? 'license (' + (b.failStage || 'compile') + ')' : b.failStage || 'compile'}` : 'ok'}${errs.length ? ` (${errs.length} message(s))` : ''}`);
    if (b.license) log(`   ${b.licenseLines.slice(0, 2).join(' | ')}`);
    b.model = b.model || model;
  }
  // jobs: explicit list (retry) or the full test x seed x config product
  const jobs = [];
  if (o.jobs && o.jobs.length) o.jobs.forEach(j => { if (builds[j.config]) jobs.push({ config: j.config, test: alias(j.test), seed: Number(j.seed) }); });
  else if (!o.buildOnly) for (const c of configs) for (const t of suiteTests) for (const s of seeds) jobs.push({ config: c.name, test: t, seed: s });
  for (const j of jobs) {
    const b = builds[j.config];
    const rdir = path.join(runDir, 'tests', j.config, j.test, String(j.seed));
    mkdir(rdir);
    const plusargs = [`+TEST=${j.test}`, `+SEED=${j.seed}`, ...(o.scenario ? [`+SCENARIO=${o.scenario}`] : []), ...(waves ? ['+WAVES'] : []), ...(o.iterations ? [`+ITERATIONS=${o.iterations}`] : [])];
    const r = { config: j.config, test: j.test, seed: j.seed, params: b.params, dir: rel(runDir, rdir), waves, status: 'NOT RUN', time: 0, parsed: parseSimLog(''), command: '' };
    if (token && token.isCancellationRequested) { r.status = 'CANCELLED'; runs.push(r); continue; }
    if (b.failed) { r.status = b.blocked ? 'BLOCKED' : b.license ? 'LICENSE' : 'ERROR'; r.stage = b.license ? 'license' : b.failStage; r.reason = b.blocked ? (b.errors[0] || {}).message : b.license ? 'license checkout failed' : 'build failed'; runs.push(r); continue; }
    const cmd = adapter.run({ root, container: !!det.container, buildDir: b.dir, runDir: rdir, plusargs, t: det.tools, cov, test: j.test, waves, vhdl, vhdlStd: cfg.vhdl_std || '08', stopTime: cfg.options.stop_time });
    r.command = sim.redact(cmdLine(cmd), simId);
    if (det.container) cmd.container = true;
    const res = await runProc(cmd, path.join(rdir, 'sim.log'), (o.timeoutS || 300) * 1000, token, env, simId);
    r.code = res.code; r.killedBy = res.killedBy; r.time = Math.round(res.ms / 10) / 100; r.procError = res.error || null;
    r.parsed = parseSimLog(fs.existsSync(path.join(rdir, 'sim.log')) ? read(path.join(rdir, 'sim.log')) : '');
    if (vhdl && r.parsed.result == null && r.code === 0 && !r.parsed.asserts.length && /DVFLOW_RESULT/.test(read(path.join(rdir, 'sim.log'))) === false) r.parsed.noResultLine = true;
    r.status = statusOf(r, null);
    r.stage = r.status === 'PASS' ? null : r.status === 'LICENSE' ? 'license' : r.procError && /ENOENT/.test(r.procError) ? 'installation' : 'test';
    if (wavesMode === 'fail' && r.status === 'FAIL' && !(token && token.isCancellationRequested)) {
      // same build, same seed, waveform on: the failure is reproduced with a waves.vcd for debugging
      const wcmd = adapter.run({ root, container: !!det.container, buildDir: b.dir, runDir: rdir, plusargs: [...plusargs, '+WAVES'], t: det.tools, cov: false, test: j.test, waves: true, vhdl, vhdlStd: cfg.vhdl_std || '08', stopTime: cfg.options.stop_time });
      if (det.container) wcmd.container = true;
      await runProc(wcmd, path.join(rdir, 'sim_waves.log'), (o.timeoutS || 300) * 1000, token, env, simId);
      r.waves = fs.existsSync(path.join(rdir, 'waves.vcd'));
      if (r.waves) r.wavesOnFailure = true;
    }
    if (fs.existsSync(path.join(rdir, 'cov.ucdb'))) r.ucdb = rel(runDir, path.join(rdir, 'cov.ucdb'));
    log(`[${r.status.padEnd(10)}] ${j.config}/${j.test} seed=${j.seed} (${r.time}s)${r.wavesOnFailure ? '  [waves.vcd written for this failure]' : ''}${r.parsed.mismatches[0] ? `  first mismatch: ${r.parsed.mismatches[0].signal} exp=${r.parsed.mismatches[0].expected} act=${r.parsed.mismatches[0].actual} @${r.parsed.mismatches[0].time}ns` : ''}${r.parsed.missing[0] ? `  missing ${r.parsed.missing[0].missing} transaction(s)` : ''}${r.status === 'LICENSE' ? '  ' + (r.parsed.licenseLines || [])[0] : ''}`);
    runs.push(r);
  }
  // failure folders
  for (const r of runs) {
    if (r.status === 'PASS' || r.status === 'CANCELLED' || r.status === 'NOT RUN') continue;
    const b = builds[r.config];
    const name = configs.length > 1 ? `${r.test}@${r.config}` : r.test;
    const fdir = path.join(runDir, 'failures', name, String(r.seed));
    mkdir(fdir);
    const rdirAbs = path.join(runDir, r.dir);
    if (fs.existsSync(path.join(b.dir, 'build.log'))) fs.copyFileSync(path.join(b.dir, 'build.log'), path.join(fdir, 'build.log'));
    if (fs.existsSync(path.join(rdirAbs, 'sim.log'))) fs.copyFileSync(path.join(rdirAbs, 'sim.log'), path.join(fdir, 'sim.log'));
    else fs.writeFileSync(path.join(fdir, 'sim.log'), `# simulation did not run (${r.status}${r.reason ? ': ' + r.reason : ''})\n`);
    if (fs.existsSync(path.join(rdirAbs, 'waves.vcd'))) fs.copyFileSync(path.join(rdirAbs, 'waves.vcd'), path.join(fdir, 'waves.vcd'));
    const rerunArgs = `rerun --run ${runId} --test ${r.test} --seed ${r.seed} --config ${r.config} --sim ${simId}`;
    fs.writeFileSync(path.join(fdir, 'command.txt'), `# build (${r.config})\n${b.commands.join('\n')}\n\n# simulate\n${r.command || '(not run)'}\n\n# cwd: ${rdirAbs}\n# license variables are inherited from the environment / per-user settings and are not recorded here\n`);
    fs.writeFileSync(path.join(fdir, 'config.json'), JSON.stringify({ dut: cfg.dut, template: cfg.template, behavior: cfg.behavior, clock: cfg.clock, reset: cfg.reset, options: cfg.options, config: r.config, params: r.params, test: r.test, seed: r.seed, simulator: simId, simVersion: det.version, rev }, null, 2));
    const relRoot = rel(fdir, root);
    fs.writeFileSync(path.join(fdir, 'rerun.cmd'), `@echo off\r\nrem Re-run ${r.test} seed ${r.seed} with waveforms (same engine as the extension)\r\ncd /d "%~dp0${relRoot.replace(/\//g, '\\')}"\r\ncall .\\dvflow.cmd ${rerunArgs} --waves 1 %*\r\n`);
    fs.writeFileSync(path.join(fdir, 'rerun.sh'), `#!/usr/bin/env sh\n# Re-run ${r.test} seed ${r.seed} with waveforms\ncd "$(dirname "$0")/${relRoot}" && ./dvflow.sh ${rerunArgs} --waves 1 "$@"\n`);
    try { fs.chmodSync(path.join(fdir, 'rerun.sh'), 0o755); } catch (e) { /* windows */ }
    const cls = classify(r, b);
    r.classification = cls;
    r.failureDir = rel(runDir, fdir);
    const first = r.parsed.mismatches[0] || r.parsed.missing[0] || null;
    r.signature = `${cls.kind}:${first ? (first.signal || 'txn') + ':' + first.scenario : (b.errors[0] ? (b.errors[0].message || '').slice(0, 60) : r.status)}`;
    r.firstError = sim.redact(cls.kind === 'license' ? `license checkout failed: ${((b.licenseLines || r.parsed.licenseLines || [])[0] || '').slice(0, 160)}` : first ? (first.signal ? `${first.signal} expected ${first.expected} got ${first.actual} @${first.time}ns (${first.scenario})` : `${first.missing} missing transaction(s) in ${first.scenario}`) : (b.failed ? (b.errors[0] ? `${b.errors[0].file ? b.errors[0].file + ':' + b.errors[0].line + ' ' : ''}${b.errors[0].message}` : 'build failed') : (r.parsed.timeout ? 'timeout' : r.reason || r.status)), simId);
    r.nextAction = nextAction(cls, { simId, b, r, runId, rerunArgs });
    fs.writeFileSync(path.join(fdir, 'triage.md'), sim.redact(triage({ r, cls, build: b, root, failDir: fdir, cfg, model: b.model || {}, runId, simLabel: adapter.label, simVersion: det.version || '', rev, rerunCli: (sim.IS_WIN ? '.\\dvflow.cmd ' : './dvflow.sh ') + rerunArgs + ' --waves 1' }), simId));
  }
  const firstFail = runs.find(r => r.nextAction);
  if (firstFail) { log(`!! STAGE ${firstFail.classification.stage || firstFail.stage}: ${firstFail.classification.label} — ${firstFail.firstError}`); log(`   NEXT: ${firstFail.nextAction}`); }
  // aggregate
  meta.finished = new Date().toISOString();
  // union of scenarios / bins / requirements over every configuration (e.g. count values that exist only for larger N)
  const models = Object.values(builds).map(b => b.model).filter(Boolean);
  const uniq = (arr, k) => [...new Map(arr.map(x => [x[k], x])).values()];
  const model = models.length ? Object.assign({}, models[0], { scenarios: uniq(models.flatMap(m => m.scenarios), 'id'), bins: uniq(models.flatMap(m => m.bins), 'id'), requirements: uniq(models.flatMap(m => m.requirements), 'id') }) : null;
  // simulator code / covergroup coverage: merge every run's UCDB and report (Questa)
  if (cov && simId === 'questa' && !vhdl) {
    const ucdbs = runs.filter(r => r.ucdb).map(r => path.join(runDir, r.ucdb));
    let dutModules = [];
    try { const hp = require('../hdlparse'); dutModules = cfg.dut.files.flatMap(f => hp.parseModules(read(path.join(root, f))).map(m => m.name)); } catch (e) { /* names unknown: fall back to totals */ }
    try {
      const c = require('./qcov').collect({ tools: det.tools, ucdbs, outDir: path.join(runDir, 'coverage'), env: sim.licenseEnv(simId, ov), dutModules, dutFiles: cfg.dut.files, log });
      if (c.files) for (const k of Object.keys(c.files)) if (c.files[k]) c.files[k] = rel(runDir, c.files[k]);
      meta.codeCov = c;
      if (c.state !== 'reported') log(`!! coverage: ${c.state} — ${c.message}`);
    } catch (e) { meta.codeCov = { state: 'error', message: e.message }; log('!! coverage: ' + e.message); }
  }
  // Verilator: merge the coverage.dat of every run (line / branch / toggle of the DUT files)
  if (cov && simId === 'verilator' && !vhdl) {
    const dats = runs.filter(r => r.dir).map(r => path.join(runDir, r.dir, 'coverage.dat')).filter(f => fs.existsSync(f));
    try {
      const c = require('./vcov').collect({ tool: det.tools.verilator_coverage, container: det.container, dats, outDir: path.join(runDir, 'coverage'), dutFiles: cfg.dut.files, root, log });
      if (c.files) for (const k of Object.keys(c.files)) if (c.files[k]) c.files[k] = rel(runDir, c.files[k]);
      meta.codeCov = c;
      if (c.state !== 'reported') log(`!! coverage: ${c.state} — ${c.message}`);
    } catch (e) { meta.codeCov = { state: 'error', message: e.message }; log('!! coverage: ' + e.message); }
  }
  const result = assemble(root, cfg, meta, runs, builds, model);
  const resultText = sim.redact(JSON.stringify(result, null, 2), simId);
  fs.writeFileSync(path.join(runDir, 'results.json'), resultText);
  fs.writeFileSync(path.join(runDir, 'results.ndjson'), result.runs.map(r => JSON.stringify({ suite: meta.suite, test: r.test, config: r.config, seed: r.seed, status: r.status, stage: r.stage || null, duration_s: r.time, message: r.firstError || null, simulator: simId, failure_dir: r.failureDir || null })).map(l => sim.redact(l, simId)).join('\n') + '\n');
  fs.writeFileSync(path.join(runDir, 'junit.xml'), sim.redact(junit(result), simId));
  // test plan: rewrite only the generated results block
  const tp = require('./layout').planYaml(root);
  if (fs.existsSync(tp) && !quiet) fs.writeFileSync(tp, plan.updateResults(read(tp), result, rel(root, runDir)));   // bug demos / mutants never touch the real plan
  if (!o.mutant) require('./report').write(root, JSON.parse(resultText));
  scrubDir(runDir, simId);   // simulators write their own files too (e.g. Questa 'transcript'): keep licence values out of all of them
  let xlsxPath = null;
  if (!quiet) {
    try { xlsxPath = require('./planxlsx').write(root, JSON.parse(resultText)); } catch (e) { log('# testplan.xlsx not written: ' + e.message); }
    fs.writeFileSync(path.join(root, 'runs', 'latest.txt'), runId + '\n');
  }
  log(`== ${result.totals.pass}/${result.totals.runs} passed · functional coverage ${result.coverage.functional.pct == null ? 'n/a' : result.coverage.functional.pct + '%'} · report: ${rel(root, path.join(runDir, 'report', 'index.html'))}`);
  result.paths = { project: root, run: runDir, report: path.join(runDir, 'report', 'index.html'), testplanYaml: require('./layout').planYaml(root), testplanXlsx: xlsxPath, failures: runs.some(r => r.failureDir) ? path.join(runDir, 'failures') : null };
  log(`   run folder:      ${result.paths.run}`);
  log(`   dashboard:       ${result.paths.report}`);
  log(`   test plan:       ${result.paths.testplanYaml}${xlsxPath ? '\n   test plan Excel: ' + xlsxPath : ''}`);
  if (result.paths.failures) runs.filter(r => r.failureDir).slice(0, 10).forEach(r => log(`   failure:         ${path.join(runDir, r.failureDir)}  (${r.firstError})`));
  result.exitCode = result.totals.runs && result.totals.pass === result.totals.runs ? 0 : (result.runs.some(x => ['FAIL', 'TIMEOUT'].includes(x.status)) ? 1 : 2);
  if (o.buildOnly) result.exitCode = Object.values(builds).some(b => b.failed) ? 2 : 0;
  if (o.bug) {
    // bug-injection demo: success means the checker caught the injected bug
    const caught = runs.some(r => ['FAIL', 'TIMEOUT'].includes(r.status));
    result.bugDemo = { caught };
    log(caught ? '== bug-injection demo: injected bug DETECTED by the testbench (expected) ✓' : '== bug-injection demo: injected bug NOT detected ✗ — the checker missed it');
    result.exitCode = caught ? 0 : 1;
  }
  return result;
}

/**
 * Coverage request -> mode. 'both' | 'code' | 'functional' | 'none'.
 * Accepts the old numeric form too: 1 = both, 0 = functional (testbench bins / covergroups only).
 */
function covMode(v, fallback) {
  if (v == null || v === '') return fallback || 'functional';
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'both', 'all', 'yes', 'on', 'code+functional', 'functional+code'].includes(s)) return 'both';
  if (['code', 'code-only'].includes(s)) return 'code';
  if (['none', 'off', 'no'].includes(s)) return 'none';
  return 'functional';   // '0', 'functional', 'fun', ...
}

/* ------------------------------------------------------------------ result assembly (coverage, plan, comparison) */
function codeRow(meta, caps) {
  const base = { type: 'Code: line/branch/condition/toggle/FSM', pct: null };
  if (caps.code_coverage !== 'yes') return Object.assign(base, { state: 'unsupported', note: `${meta.simLabel} has no code-coverage engine` });
  if (!meta.coverage.code) return Object.assign(base, { state: 'disabled', note: meta.coverage.mode === 'functional' ? 'not requested (coverage: functional only)' : 'enable code coverage (Run Test / Run Regression → coverage, or --cov both)' });
  const c = meta.codeCov;
  if (!c) return Object.assign(base, { state: 'unavailable', note: 'coverage was enabled but not post-processed for this simulator; see the UCDB of each run' });
  if (c.state !== 'reported') return Object.assign(base, { state: c.state === 'license' ? 'blocked' : 'unavailable', note: c.message });
  return Object.assign(base, { state: 'reported', pct: c.code.pct, hit: c.code.metrics.reduce((s, x) => s + x.hits, 0), total: c.code.metrics.reduce((s, x) => s + x.bins, 0), metrics: c.code.metrics, note: `merged over ${c.runs} run(s) · ${c.scope}`, files: c.files, uncovered: c.uncovered || null });
}
function functionalRow(meta, exec, countable, bins, fpct) {
  const base = { type: 'Functional (testbench bins)' };
  if (meta.coverage && meta.coverage.functional === false) return Object.assign(base, { state: 'disabled', pct: null, note: `not requested (coverage: ${meta.coverage.mode || 'code'} only)` });
  // UVM / covergroup flows: the functional numbers are the covergroup bins from the UCDB
  const c = meta.codeCov;
  if (!exec.length && c && c.state === 'reported' && c.covergroups && c.covergroups.pct != null) {
    const b = c.covergroups.bins;
    return Object.assign(base, { type: 'Functional (covergroup bins)', state: 'reported', pct: b && b.total ? Math.round(b.hit * 10000 / b.total) / 100 : c.covergroups.pct, hit: b ? b.hit : null, total: b ? b.total : null, note: `from the UCDB: ${c.covergroups.groups.length || 'all'} covergroup type(s), merged over ${c.runs} run(s)` });
  }
  return Object.assign(base, { state: exec.length ? 'reported' : 'unavailable', pct: fpct, hit: countable.filter(x => x.state === 'hit').length, total: countable.length, note: `${bins.filter(x => x.state === 'waived').length} waived (excluded)` });
}
function covergroupRow(meta, caps) {
  const base = { type: 'Simulator covergroups', pct: null };
  if (caps.simulator_covergroups !== 'yes') return Object.assign(base, { state: 'unsupported', note: `${meta.simLabel} does not support SV covergroups` });
  if (meta.coverage && meta.coverage.functional === false) return Object.assign(base, { state: 'disabled', note: 'not requested (coverage: code only)' });
  const c = meta.codeCov;
  const uvm = meta.kind === 'uvm';
  if (!c || c.state !== 'reported' || c.covergroups.pct == null) return Object.assign(base, { state: uvm ? 'unavailable' : 'not collected in this flow', note: uvm ? (c && c.state !== 'reported' ? c.message : 'no covergroup data in the merged UCDB (was coverage enabled for this run?)') : 'the simple testbench samples its own bins (row above); run the UVM testbench on Questa / VCS for covergroup coverage' });
  return Object.assign(base, { state: 'reported', pct: c.covergroups.pct, metrics: c.covergroups.metrics, groups: c.covergroups.groups, note: `${c.covergroups.groups.length} covergroup type(s)`, files: c.files });
}

function assemble(root, cfg, meta, runs, builds, model) {
  const waivers = loadWaivers(root);
  const tpFile = require('./layout').planYaml(root);
  const tpText = fs.existsSync(tpFile) ? read(tpFile) : '';
  const tp = plan.parsePlan(tpText);
  const binDefs = (model ? model.bins : []).map(b => ({ id: b.id, scenario: b.scenario, desc: b.desc, cond: b.cond, stimulus: b.stimulus }));
  const scenarios = (model ? model.scenarios : []).map(s => ({ id: s.id, req: s.req, title: s.title, test: s.test, desc: s.desc, stimulus: s.stimulus, expected: s.expected }));
  const exec = runs.filter(r => r.parsed && Object.keys(r.parsed.bins).length);
  const bins = binDefs.map(b => {
    const contrib = exec.filter(r => r.parsed.bins[b.id] > 0).map(r => ({ test: r.test, seed: r.seed, config: r.config, hits: r.parsed.bins[b.id] }));
    const hits = contrib.reduce((s, x) => s + x.hits, 0);
    const w = waivers.find(x => x.bin === b.id);
    let state = hits > 0 ? 'hit' : 'unhit';
    if (state === 'unhit' && w && !w.expired) state = 'waived';
    if (!exec.length) state = 'unavailable';
    const sc = scenarios.find(s => s.id === b.scenario) || {};
    let suggestion = null;
    if (state === 'unhit') {
      const scRuns = runs.filter(r => r.parsed && r.parsed.scenarios[b.scenario] && r.parsed.scenarios[b.scenario].ran);
      const testInSuite = meta.tests.includes(sc.test);
      const failed = scRuns.some(r => r.parsed.scenarios[b.scenario].fails > 0 || r.status !== 'PASS');
      if (failed) suggestion = { kind: 'needs investigation', reason: `Scenario ${b.scenario} ran but its runs failed or ended early, so this bin may not have been reached.`, stimulus: b.stimulus };
      else if (scRuns.length >= 3) suggestion = { kind: 'waiver candidate for review', reason: `Never reached in ${scRuns.length} passing runs that executed scenario ${b.scenario}. Confirm the condition is reachable for these parameters; if not, waive it in waivers.yaml with a rationale and reviewer, otherwise adjust the stimulus.`, stimulus: b.stimulus };
      else if (scRuns.length) suggestion = { kind: 'existing test needs adjustment', reason: `Scenario ${b.scenario} (test '${sc.test}') ran and passed but never produced this condition — its stimulus does not reach it.`, stimulus: b.stimulus };
      else if (sc.test && !testInSuite) suggestion = { kind: 'existing test needs adjustment', reason: `Test '${sc.test}' implements scenario ${b.scenario} but was not part of this regression (suite: ${meta.tests.join(', ')}). Add it to the suite.`, stimulus: `${b.stimulus} — run: dvflow run --test ${sc.test}` };
      else if (!sc.test) suggestion = { kind: 'new stimulus may be needed', reason: 'No test is mapped to this bin\'s scenario.', stimulus: b.stimulus };
      else suggestion = { kind: 'new stimulus may be needed', reason: `Test '${sc.test}' was in the suite but scenario ${b.scenario} did not execute (scenario filter or early exit).`, stimulus: b.stimulus };
      if (w && w.expired) suggestion.reason += ` (waiver expired ${w.expires})`;
    }
    return { ...b, hits, state, contributors: contrib, attribution: 'per test/seed (collected before merging)', waiver: w || null, scenarioTitle: sc.title || '', scenarioTest: sc.test || '', suggestion };
  });
  const countable = bins.filter(b => b.state === 'hit' || b.state === 'unhit');
  const fpct = countable.length ? Math.round(countable.filter(b => b.state === 'hit').length * 10000 / countable.length) / 100 : null;
  // simulator coverage (code coverage): only where the adapter supports it and data exists
  const caps = meta.capabilities;
  const types = [
    functionalRow(meta, exec, countable, bins, fpct),
    covergroupRow(meta, caps),
    codeRow(meta, caps),
    { type: 'Assertions (concurrent SVA)', state: caps.assertions === 'unsupported' ? 'unsupported' : (meta.coverage.assertions ? 'reported' : 'disabled'), pct: null, note: caps.assertions === 'unsupported' ? 'checked only on Questa/VCS' : '' }
  ];
  // scenarios: execution vs coverage, honouring engineer status
  const scen = scenarios.map(s => {
    const authored = (tp.scenarios || []).find(x => x.id === s.id) || {};
    const rr = runs.filter(r => r.parsed && r.parsed.scenarios[s.id] && r.parsed.scenarios[s.id].ran);
    let execution;
    if (/^(skipped|blocked)$/.test(authored.status || '')) execution = authored.status;
    else if (runs.length && runs.every(r => r.status === 'BLOCKED')) execution = 'blocked';
    else if (!rr.length) execution = meta.tests.includes(s.test) ? 'not run' : 'not run';
    else if (rr.some(r => r.parsed.scenarios[s.id].fails > 0)) execution = 'failed';
    else if (rr.some(r => r.status !== 'PASS' && r.parsed.timeout && r.parsed.timeout.scenario === s.id)) execution = 'failed';
    else execution = 'passed';
    const sb = bins.filter(b => b.scenario === s.id && b.state !== 'waived');
    const coverage = !sb.length ? 'n/a' : sb.every(b => b.state === 'hit') ? 'covered' : sb.some(b => b.state === 'hit') ? 'partial' : (sb.every(b => b.state === 'unavailable') ? 'unavailable' : 'not covered');
    return { ...s, execution, coverage, planned: !s.test, runs: rr.map(r => ({ test: r.test, seed: r.seed, config: r.config, status: r.status, checks: r.parsed.scenarios[s.id].checks, fails: r.parsed.scenarios[s.id].fails, evidence: r.dir + '/sim.log' })) };
  });
  // requirements roll-up
  const reqs = (model ? model.requirements : []).map(q => {
    const ss = scen.filter(s => s.req === q.id);
    const rb = bins.filter(b => ss.some(s => s.id === b.scenario));
    const cnt = rb.filter(b => b.state === 'hit' || b.state === 'unhit');
    return { id: q.id, text: q.text, scenarios: ss.map(s => s.id), execution: ss.some(s => s.execution === 'failed') ? 'failed' : ss.every(s => s.execution === 'passed') && ss.length ? 'passed' : ss.some(s => s.execution === 'passed') ? 'partial' : 'not run', coveragePct: cnt.length ? Math.round(cnt.filter(b => b.state === 'hit').length * 10000 / cnt.length) / 100 : null };
  });
  // failure signatures
  const sigs = {};
  runs.filter(r => r.signature).forEach(r => { (sigs[r.signature] = sigs[r.signature] || { signature: r.signature, kind: r.classification.label, first: r.firstError, runs: [] }).runs.push({ test: r.test, seed: r.seed, config: r.config, failureDir: r.failureDir }); });
  // comparison with the previous run
  const prev = previousRun(root, meta.runId);
  let comparison = null;
  if (prev) {
    const key = r => `${r.config}/${r.test}/${r.seed}`;
    const pm = new Map(prev.runs.map(r => [key(r), r.status]));
    comparison = {
      previousRunId: prev.meta.runId,
      newFailures: runs.filter(r => r.status !== 'PASS' && pm.get(key(r)) === 'PASS').map(key),
      fixed: runs.filter(r => r.status === 'PASS' && pm.has(key(r)) && pm.get(key(r)) !== 'PASS').map(key),
      stillFailing: runs.filter(r => r.status !== 'PASS' && pm.has(key(r)) && pm.get(key(r)) !== 'PASS').map(key),
      coverageDelta: prev.coverage && prev.coverage.functional.pct != null && fpct != null ? Math.round((fpct - prev.coverage.functional.pct) * 100) / 100 : null,
      newlyHit: bins.filter(b => b.state === 'hit' && (prev.bins || []).some(x => x.id === b.id && x.state !== 'hit')).map(b => b.id),
      lost: bins.filter(b => b.state !== 'hit' && (prev.bins || []).some(x => x.id === b.id && x.state === 'hit')).map(b => b.id)
    };
  }
  const totals = { runs: runs.length, pass: runs.filter(r => r.status === 'PASS').length, fail: runs.filter(r => r.status === 'FAIL').length, timeout: runs.filter(r => r.status === 'TIMEOUT').length, error: runs.filter(r => r.status === 'ERROR').length, incomplete: runs.filter(r => r.status === 'INCOMPLETE').length, blocked: runs.filter(r => r.status === 'BLOCKED').length, license: runs.filter(r => r.status === 'LICENSE').length, cancelled: runs.filter(r => r.status === 'CANCELLED').length };
  const slim = runs.map(r => ({ config: r.config, test: r.test, seed: r.seed, params: r.params, status: r.status, stage: r.stage || null, nextAction: r.nextAction || null, time: r.time, code: r.code, dir: r.dir, command: r.command, errors: r.parsed.errors, checks: r.parsed.checks, firstError: r.firstError || null, classification: r.classification || null, failureDir: r.failureDir || null, signature: r.signature || null, ucdb: r.ucdb || null, waves: r.waves, scenarios: r.parsed.scenarios, bins: r.parsed.bins }));
  return { meta, totals, runs: slim, builds: Object.values(builds).map(b => ({ config: b.config, params: b.params, failed: b.failed, blocked: !!b.blocked, errors: b.errors, commands: b.commands, log: rel(path.join(root, 'runs', meta.runId), path.join(b.dir, 'build.log')) })), coverage: { functional: { pct: meta.coverage && meta.coverage.functional === false ? null : (types[0] && types[0].state === 'reported' ? types[0].pct : fpct) }, types }, bins, scenarios: scen, requirements: reqs, signatures: Object.values(sigs), comparison, waivers };
}

function junit(res) {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const byCfg = {};
  res.runs.forEach(r => (byCfg[r.config] = byCfg[r.config] || []).push(r));
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${esc(res.meta.dut)}" tests="${res.totals.runs}" failures="${res.totals.fail + res.totals.timeout}" errors="${res.totals.error + res.totals.incomplete + res.totals.blocked}">
${Object.entries(byCfg).map(([c, rs]) => `  <testsuite name="${esc(res.meta.dut)}.${esc(c)}" tests="${rs.length}" failures="${rs.filter(r => ['FAIL', 'TIMEOUT'].includes(r.status)).length}" errors="${rs.filter(r => ['ERROR', 'INCOMPLETE', 'BLOCKED'].includes(r.status)).length}" skipped="${rs.filter(r => r.status === 'CANCELLED').length}">
${rs.map(r => `    <testcase classname="${esc(res.meta.dut)}.${esc(c)}" name="${esc(r.test)}[seed=${r.seed}]" time="${r.time || 0}">${r.status === 'PASS' ? '' : ['FAIL', 'TIMEOUT'].includes(r.status) ? `<failure message="${esc(r.firstError)}" type="${esc(r.classification ? r.classification.label : r.status)}">${esc(r.failureDir || '')}</failure>` : r.status === 'CANCELLED' ? '<skipped/>' : `<error message="${esc(r.firstError || r.status)}" type="${esc(r.status)}"/>`}</testcase>`).join('\n')}
  </testsuite>`).join('\n')}
</testsuites>
`;
}

async function rerun(root, o) {
  const runId = o.run === 'latest' || !o.run ? (fs.existsSync(path.join(root, 'runs', 'latest.txt')) ? read(path.join(root, 'runs', 'latest.txt')).trim() : null) : o.run;
  let simId = o.sim;
  if (runId && fs.existsSync(path.join(root, 'runs', runId, 'results.json'))) {
    const prev = JSON.parse(read(path.join(root, 'runs', runId, 'results.json')));
    simId = simId || prev.meta.simulator;
  }
  return regress(root, Object.assign({}, o, { sim: simId, tests: [o.test], seeds: [Number(o.seed)], configs: o.config ? [o.config] : null, suite: 'rerun' }));
}

/** Redact licence values in every text artifact under dir (logs, vendor transcripts, reports). Binary files are left alone. */
function scrubDir(dir, simId) {
  const walk = d => { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'work' && e.name !== 'obj_dir') walk(p); continue; }
    if (!/^(transcript|.*\.(log|txt|md|json|ndjson|html|xml|yaml|f|do|ini|cmd|sh|rpt))$/i.test(e.name)) continue;
    try { const st = fs.statSync(p); if (st.size > 50 * 1024 * 1024) continue; const t = fs.readFileSync(p, 'utf8'); const u = sim.redact(t, simId); if (u !== t) fs.writeFileSync(p, u); } catch (err) { /* unreadable */ } } };
  walk(dir);
}

async function retry(root, o) {
  const id = !o.run || o.run === 'latest' ? (fs.existsSync(path.join(root, 'runs', 'latest.txt')) ? read(path.join(root, 'runs', 'latest.txt')).trim() : null) : o.run;
  if (!id) throw Object.assign(new Error('No previous run to retry.'), { exitCode: 3 });
  const prev = JSON.parse(read(path.join(root, 'runs', id, 'results.json')));
  const req = prev.meta.request || {};
  const failed = prev.runs.filter(r => r.status !== 'PASS');
  const jobs = (failed.length ? failed : prev.runs).map(r => ({ config: r.config, test: r.test, seed: r.seed }));
  (o.log || (() => {}))(`== retry of ${id}: ${jobs.length} job(s) on ${o.sim || req.sim || prev.meta.simulator} (same tests, seeds and parameters; testbench and Makefile are not regenerated)`);
  return regress(root, Object.assign({}, o, { sim: o.sim || req.sim || prev.meta.simulator, configs: [...new Set(jobs.map(j => j.config))], jobs, waves: o.waves != null ? o.waves : req.waves, cov: o.cov != null ? o.cov : req.cov, suite: 'retry' }));
}

function clean(root) {
  for (const d of ['runs']) { const p = path.join(root, d); if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
}

module.exports = { wavesModeOf, covMode, functionalRow, covergroupRow, codeRow, loadConfig, plannedFiles, writeFiles, regress, rerun, retry, clean, nextAction, scrubDir, parseSimLog, classify, statusOf, junit, nowId, runProc, assemble };

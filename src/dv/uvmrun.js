'use strict';
/*
 * UVM testbench runner: compiles and runs the generated uvm/ environment on a chosen simulator.
 *   questa     validated compile (vlog/vsim, built-in UVM)
 *   vcs        -ntb_opts uvm (built-in UVM)                       — unvalidated
 *   verilator  experimental: needs Verilator >= 5 and UVM sources (UVM_HOME or ~/.dvflow/simulators.json verilator.uvm_home)
 * Verdict comes from the UVM report summary: PASS only when the summary is present and UVM_ERROR = UVM_FATAL = 0.
 * Results go to runs/<id>-uvm-<sim>/<test>/<seed>/ ; runs/latest.txt (lightweight dashboard / Excel) is not touched.
 */
const fs = require('fs');
const path = require('path');
const sim = require('./sim');
const runner = require('./runner');

const UVM_SIMS = ['questa', 'vcs', 'verilator'];

/** UVM test classes declared in uvm/<top>_tests.sv (excluding the base test). */
function listTests(root, cfg) {
  const f = require('./layout').uvmPath(root, cfg.dut.top, `${cfg.dut.top}_tests.sv`);
  if (!fs.existsSync(f)) return [];
  const out = [];
  const re = /^\s*class\s+(\w+)\s+extends\s+\w+/gm;
  let m;
  const txt = fs.readFileSync(f, 'utf8');
  while ((m = re.exec(txt))) if (!/_base_test$/.test(m[1])) out.push(m[1]);
  return out;
}

/** 'smoke' -> '<top>_dv_smoke_test'; full class names pass through. */
function testName(cfg, t) { return /_test$/.test(t) ? t : `${cfg.dut.top}_dv_${t}_test`; }

function uvmHome(simId) {
  const u = sim.loadUser()[simId] || {};
  return process.env.UVM_HOME || u.uvm_home || '';
}

function steps(simId, t, ctx) {
  const { uvmDir, runDir, test, seed, cov } = ctx;
  if (simId === 'questa') {
    const lib = path.join(runDir, 'work');
    const inc = uvmHome('questa') ? ['+incdir+' + path.join(uvmHome('questa'), 'src')] : [];
    const cv = cov && cov.code ? ['+cover=bcesft'] : [];
    return {
      build: [
        { stage: 'compile', cmd: t.vlib, args: [lib], cwd: uvmDir },
        { stage: 'compile', cmd: t.vlog, args: ['-sv', '-timescale', '1ns/1ps', '+acc', ...cv, '-work', lib, ...inc, '-f', 'files.f'], cwd: uvmDir },
        { stage: 'elaborate', cmd: t.vopt, args: ['-work', lib, '+acc', ...cv, 'tb_top', '-o', 'tb_opt'], cwd: uvmDir }
      ],
      run: { stage: 'simulate', cmd: t.vsim, args: ['-c', '-lib', lib, ...(cov && cov.code ? ['-coverage'] : []), 'tb_opt', `+UVM_TESTNAME=${test}`, '-sv_seed', String(seed), '+UVM_VERBOSITY=UVM_MEDIUM', '-do', (cov ? 'coverage save -onexit cov.ucdb; ' : '') + 'run -all; quit -f'], cwd: runDir }
    };
  }
  if (simId === 'vcs') {
    const simv = path.join(runDir, 'simv');
    return {
      build: [{ stage: 'compile', cmd: t.vcs, args: ['-full64', '-sverilog', '-timescale=1ns/1ps', '-ntb_opts', 'uvm-1.2', '-debug_access+all', '-f', 'files.f', '-top', 'tb_top', '-Mdir=' + path.join(runDir, 'csrc'), '-o', simv], cwd: uvmDir }],
      run: { stage: 'simulate', cmd: simv, args: [`+UVM_TESTNAME=${test}`, `+ntb_random_seed=${seed}`, '+UVM_VERBOSITY=UVM_MEDIUM'], cwd: runDir }
    };
  }
  if (simId === 'verilator') {
    const home = ctx.container ? '/opt/uvm' : uvmHome('verilator');     // the container image ships UVM at /opt/uvm
    if (!ctx.container && (!home || !fs.existsSync(path.join(home, 'src', 'uvm_pkg.sv')))) {
      throw Object.assign(new Error(`Verilator UVM needs the UVM sources: set UVM_HOME (or "uvm_home" under "verilator" in ${sim.USER_FILE}) to a UVM 2017/2020 folder containing src/uvm_pkg.sv. Current: '${home || 'not set'}'.`), { exitCode: 2, blocked: true });
    }
    const v = t[sim.IS_WIN ? 'verilator_bin' : 'verilator'];
    // in the container, compile on its own filesystem: UVM expands to thousands of C++ files, far too slow on a
    // Windows-mounted folder; the executable stays in the container and runs there
    const obj = ctx.container ? '/tmp/tenx-obj/' + path.basename(path.dirname(runDir)) : path.join(runDir, 'obj_dir');
    return {
      build: [...(ctx.container ? [{ stage: 'compile', cmd: 'ctr:mkdir', args: ['-p', obj], cwd: uvmDir }] : []), { stage: 'compile', cmd: v, args: ['--binary', '--timing', '-j', sim.vjobs(true), '-Wno-fatal', '-Wno-lint', '-Wno-style', '--trace', '+define+UVM_NO_DPI', '+incdir+' + (ctx.container ? home + '/src' : path.join(home, 'src')), ctx.container ? home + '/src/uvm_pkg.sv' : path.join(home, 'src', 'uvm_pkg.sv'), '-f', 'files.f', '--top-module', 'tb_top', '-Mdir', obj, '-o', 'sim'], cwd: uvmDir }],
      run: { stage: 'simulate', cmd: ctx.container ? obj + '/sim' : path.join(obj, sim.IS_WIN ? 'sim.exe' : 'sim'), args: [`+UVM_TESTNAME=${test}`, `+verilator+seed+${seed}`, '+UVM_VERBOSITY=UVM_MEDIUM'], cwd: runDir }
    };
  }
  throw Object.assign(new Error(`'${simId}' cannot run UVM. Use one of: ${UVM_SIMS.join(', ')}`), { exitCode: 3 });
}

/** Parse the UVM report summary. */
function verdict(text, code, killedBy) {
  if (killedBy === 'timeout') return { status: 'TIMEOUT', why: 'simulation timed out' };
  if (killedBy === 'cancelled') return { status: 'INCOMPLETE', why: 'cancelled' };
  const d = sim.diagnose(text);
  if (d && d.kind === 'license') return { status: 'BLOCKED', why: 'license: ' + d.lines[0] };
  const e = /UVM_ERROR\s*:\s*(\d+)/.exec(text), f = /UVM_FATAL\s*:\s*(\d+)/.exec(text);
  if (!e || !f) return { status: 'ERROR', why: d ? d.lines[0] : `no UVM report summary in the log (exit code ${code})` };
  const ne = +e[1], nf = +f[1];
  if (ne || nf) {
    const first = text.split(/\r?\n/).find(l => /UVM_(ERROR|FATAL)\s+\S+\(\d+\)|UVM_(ERROR|FATAL) @/.test(l));
    return { status: 'FAIL', why: `UVM_ERROR=${ne} UVM_FATAL=${nf}${first ? ' — ' + first.trim() : ''}` };
  }
  return { status: 'PASS', why: 'UVM_ERROR=0 UVM_FATAL=0' };
}

/**
 * Run UVM tests. o: { sim, tests:[], seeds:[], log, token, override, timeoutS }
 * returns { runId, runDir, sim, results:[{test, uvmTest, seed, status, why, log}], exitCode }
 */
async function run(root, cfg, o) {
  const log = o.log || (() => {});
  const t0 = Date.now();
  const simId = o.sim || 'questa';
  const uvmDir = path.join(root, 'uvm');
  if (!fs.existsSync(path.join(uvmDir, 'files.f'))) throw Object.assign(new Error('uvm/files.f not found — generate the testbench in "UVM" or "Both" mode first.'), { exitCode: 3 });
  if (!UVM_SIMS.includes(simId)) throw Object.assign(new Error(`'${simId}' cannot run UVM. Use one of: ${UVM_SIMS.join(', ')}`), { exitCode: 3 });
  const ov = (o.override || {})[simId] || {};
  // first run without local tools: download the Docker image (once, with progress) before choosing the simulator
  try { await require('./container').prepare({ sims: [simId], override: o.override, log, token: o.token }); }
  catch (e) { throw Object.assign(new Error('Docker toolchain: ' + e.message), { exitCode: 2 }); }
  const det = sim.detect(simId, ov);
  if (!det.available) throw Object.assign(new Error(`${sim.ADAPTERS[simId].label} unavailable: ${det.reason}. ${sim.fixHint(simId)}`), { exitCode: 2 });
  const env = sim.licenseEnv(simId, ov);
  let runId = `${runner.nowId()}-uvm-${simId}`;
  { const base = runId; let k = 2; while (fs.existsSync(path.join(root, 'runs', runId))) runId = `${base}-${k++}`; }
  const runBase = path.join(root, 'runs', runId);
  fs.mkdirSync(runBase, { recursive: true });
  const tests = (o.tests && o.tests.length ? o.tests : ['random']).map(t => testName(cfg, t));
  const seeds = (o.seeds && o.seeds.length ? o.seeds : [1]).map(Number);
  const timeoutMs = (o.timeoutS || 300) * 1000;
  const mode = require('./runner').covMode(o.cov, 'both');
  const covModes = { code: mode === 'both' || mode === 'code', functional: mode === 'both' || mode === 'functional' };
  const cov = simId === 'questa' && mode !== 'none' ? covModes : null;   // Questa: UCDB with code and/or covergroup coverage
  log(`== UVM run ${runId}: ${cfg.dut.top} on ${det.adapter.label} ${det.version} — tests [${tests.join(', ')}] x seeds [${seeds.join(', ')}]${cov ? ` · coverage: ${mode}` : ''}`);

  // one build per run (the library / executable is test-independent)
  const buildDir = path.join(runBase, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  const plan = steps(simId, det.tools, { uvmDir, runDir: buildDir, test: tests[0], seed: seeds[0], cov, container: det.container });
  if (det.container) { plan.build.forEach(s => { s.container = true; }); log(`[toolchain] ${det.source}`); }
  const buildLog = path.join(buildDir, 'compile.log');
  const results = [];
  for (const s of plan.build) {
    log(`[build] ${s.stage}: ${[s.cmd, ...s.args].join(' ')}`);
    // compiling UVM (especially on Verilator) takes far longer than a simulation: separate, generous build timeout
    const r = await runner.runProc(s, buildLog, Math.max(timeoutMs, (o.buildTimeoutS || 1800) * 1000), o.token, env, simId);
    if (r.code !== 0 || r.killedBy || r.error) {
      const txt = fs.existsSync(buildLog) ? fs.readFileSync(buildLog, 'utf8') : '';
      const d = sim.diagnose(txt);
      const why = r.killedBy ? r.killedBy : d ? d.lines[0] : (r.error || `exit code ${r.code}`);
      log(`[build] FAILED: ${why}\n        log: ${buildLog}`);
      for (const t of tests) for (const seed of seeds) results.push({ test: t, seed, status: d && d.kind === 'license' ? 'BLOCKED' : 'ERROR', why: 'build: ' + why, log: buildLog });
      return finish(root, runBase, runId, simId, det, results, log, null, { cfg, buildLog, commands: plan.build.map(x => [x.cmd, ...x.args].join(' ')), failed: true, started: t0, cov });
    }
  }
  log('[build] ok');

  const wavesMode = runner.wavesModeOf(o.waves, cfg.options.waves);   // all | fail (default: rerun failing tests with +WAVES) | none
  for (const t of tests) for (const seed of seeds) {
    if (o.token && o.token.isCancellationRequested) { results.push({ test: t, seed, status: 'INCOMPLETE', why: 'cancelled' }); continue; }
    const rd = path.join(runBase, t, String(seed));
    fs.mkdirSync(rd, { recursive: true });
    const st = steps(simId, det.tools, { uvmDir, runDir: buildDir, test: t, seed, cov, container: det.container }).run;
    if (det.container) st.container = true;
    st.cwd = rd;                                   // waves.vcd, transcript and cov.ucdb land in the test folder
    if (wavesMode === 'all') st.args.push('+WAVES');
    const lf = path.join(rd, 'sim.log');
    const r = await runner.runProc(st, lf, timeoutMs, o.token, env, simId);
    const v = verdict(fs.existsSync(lf) ? fs.readFileSync(lf, 'utf8') : '', r.code, r.killedBy);
    const ucdb = path.join(rd, 'cov.ucdb');
    let wavesOnFailure = false;
    if (wavesMode === 'fail' && v.status === 'FAIL' && !(o.token && o.token.isCancellationRequested)) {
      // same build, same seed, waveform on: the failure is reproduced with a waves.vcd for debugging
      const ws = Object.assign({}, st, { args: [...st.args, '+WAVES'] });
      await runner.runProc(ws, path.join(rd, 'sim_waves.log'), timeoutMs, o.token, env, simId);
      wavesOnFailure = fs.existsSync(path.join(rd, 'waves.vcd'));
    }
    results.push({ test: t, seed, status: v.status, why: v.why, log: lf, ms: r.ms, ucdb: fs.existsSync(ucdb) ? ucdb : null });
    log(`[${v.status.padEnd(10)}] ${t} seed=${seed} (${((r.ms || 0) / 1000).toFixed(2)}s) ${v.status === 'PASS' ? '' : '— ' + v.why}${wavesOnFailure ? '  [waves.vcd written for this failure]' : ''}`);
  }
  let coverage = null;
  if (cov) {
    let dutModules = [];
    try { const hp = require('../hdlparse'); dutModules = cfg.dut.files.flatMap(f => hp.parseModules(fs.readFileSync(path.join(root, f), 'utf8')).map(m => m.name)); } catch (e) { /* fall back to totals */ }
    coverage = require('./qcov').collect({ tools: det.tools, ucdbs: results.map(r => r.ucdb).filter(Boolean), outDir: path.join(runBase, 'coverage'), env, dutModules, dutFiles: cfg.dut.files, log, code: cov.code, functional: cov.functional });
    if (coverage.state !== 'reported') log(`[coverage] ${coverage.state}: ${coverage.message}`);
  }
  return finish(root, runBase, runId, simId, det, results, log, coverage, { cfg, buildLog, commands: plan.build.map(x => [x.cmd, ...x.args].join(' ')), failed: false, started: t0, cov });
}

function finish(root, runBase, runId, simId, det, results, log, coverage, ctx) {
  const pass = results.filter(r => r.status === 'PASS').length;
  const bad = results.some(r => r.status === 'FAIL' || r.status === 'TIMEOUT');
  const exitCode = pass === results.length ? 0 : bad ? 1 : 2;
  const res = { runId, runDir: runBase, sim: simId, simLabel: det.adapter.label, simVersion: det.version, results, totals: { runs: results.length, pass }, coverage };
  fs.writeFileSync(path.join(runBase, 'uvm_results.json'), JSON.stringify(res, null, 2));
  // dashboard: the same page as a DV regression (log, waveform, scenarios, history, compare)
  if (ctx && ctx.cfg) {
    try {
      const ext = require('./external');
      const model = ext.projectModel(root, ctx.cfg);
      const lwOf = cls => ctx.cfg.tests.find(t => testName(ctx.cfg, t) === cls) || null;
      const runs = results.map(r => {
        const dir = path.join(runBase, r.test, String(r.seed));
        const text = r.log && fs.existsSync(r.log) && r.log.startsWith(dir) ? fs.readFileSync(r.log, 'utf8') : '';
        const parsed = ext.parseUvmLog(text, model, lwOf(r.test), /closure/i.test(r.test));
        return { test: r.test, seed: r.seed, dir: path.relative(runBase, dir).replace(/\\/g, '/'), status: r.status, time: Math.round((r.ms || 0) / 10) / 100, parsed,
          firstError: r.status === 'PASS' ? null : (parsed.firstError || r.why), command: `dvflow uvm --sim ${simId} --tests ${r.test} --seed ${r.seed}`, waves: fs.existsSync(path.join(dir, 'waves.vcd')) };
      });
      const pub = ext.publish(root, ctx.cfg, { kind: 'uvm', runId, simId, det, started: ctx.started ? new Date(ctx.started).toISOString() : null, runs, codeCov: coverage && coverage.state === 'reported' ? coverage : null, covModes: ctx.cov || { code: false, functional: false },
        build: { failed: ctx.failed, errors: [], commands: ctx.commands, log: path.relative(runBase, ctx.buildLog).replace(/\\/g, '/') } });
      res.report = pub.report;
      log(`   dashboard:       ${pub.report}`);
      log(`   test plan:       ${require('./layout').planYaml(root)}`);
      if (pub.result.testplanXlsx) log(`   test plan Excel: ${pub.result.testplanXlsx}`);
      else if (pub.result.testplanError) log(`   # testplan.xlsx not written: ${pub.result.testplanError}`);
    } catch (e) { log('# dashboard not written: ' + e.message); }
  }
  log(`== UVM: ${pass}/${results.length} passed · results: ${path.join(runBase, 'uvm_results.json')}`);
  return Object.assign(res, { exitCode });
}

module.exports = { run, listTests, testName, verdict, UVM_SIMS };

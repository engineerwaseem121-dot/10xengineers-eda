'use strict';
/*
 * Run the generated cocotb testbench (cocotb/Makefile) on Icarus or Verilator.
 * Uses a local cocotb install when there is one, otherwise the container toolchain (Python + cocotb + simulators).
 * Every test x seed runs as its own `make` with its own log; results go to runs/<id>-cocotb-<sim>/ and the dashboard.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const runner = require('./runner');
const sim = require('./sim');

const SIMS = ['icarus', 'verilator'];

function localCocotb() {
  try { return cp.spawnSync('cocotb-config', ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).status === 0; } catch (e) { return false; }
}

/** where cocotb can run: { mode: 'local'|'container', reason } */
function where(root) {
  if (localCocotb()) return { mode: 'local' };
  const ct = require('./container');
  ct.configure({ roots: [root] });
  if (ct.canRun([root])) return { mode: 'container' };
  return { mode: null, reason: 'cocotb is not installed locally and the container toolchain is not set up ("10xEngineers EDA: Set Up Open-Source Toolchain")' };
}

/** names of the cocotb tests in cocotb/test_<top>.py */
function listTests(root, cfg) {
  const f = path.join(root, 'cocotb', `test_${cfg.dut.top}.py`);
  if (!fs.existsSync(f)) return [];
  const out = [];
  const re = /@cocotb\.test\([^)]*\)\s*\n\s*async def (\w+)\s*\(/g;
  let m; const t = fs.readFileSync(f, 'utf8');
  while ((m = re.exec(t))) out.push(m[1]);
  return out;
}

async function run(root, cfg, o) {
  o = o || {};
  const log = o.log || (() => {});
  const simId = o.sim || 'icarus';
  if (!SIMS.includes(simId)) throw Object.assign(new Error(`cocotb runs on ${SIMS.join(' or ')} here (got '${simId}')`), { exitCode: 3 });
  const dir = path.join(root, 'cocotb');
  if (!fs.existsSync(path.join(dir, 'Makefile'))) throw Object.assign(new Error('cocotb/Makefile not found: generate the cocotb testbench first (DV: Generate Testbench → cocotb).'), { exitCode: 3 });
  if (!localCocotb()) {
    // first run without local tools: download the Docker image (once, with progress) before choosing the simulator
    try { await require('./container').prepare({ need: true, log, token: o.token }); }
    catch (e) { throw Object.assign(new Error('Docker toolchain: ' + e.message), { exitCode: 2 }); }
  }
  const w = where(root);
  if (!w.mode) throw Object.assign(new Error(w.reason), { exitCode: 2 });
  const det = w.mode === 'container' ? Object.assign(sim.detect(simId, {}), { source: 'container' }) : sim.detect(simId, {});
  const all = listTests(root, cfg);
  const tests = o.tests && o.tests.length ? o.tests : all;
  const seeds = (o.seeds && o.seeds.length ? o.seeds : [1]).map(Number);
  let runId = `${runner.nowId()}-cocotb-${simId}`;
  { const base = runId; let k = 2; while (fs.existsSync(path.join(root, 'runs', runId))) runId = `${base}-${k++}`; }
  const runBase = path.join(root, 'runs', runId);
  fs.mkdirSync(runBase, { recursive: true });
  const t0 = Date.now();
  log(`== cocotb run ${runId}: ${cfg.dut.top} on ${simId} (${w.mode === 'container' ? 'container toolchain' : 'local cocotb'}) — tests [${tests.join(', ')}] x seeds [${seeds.join(', ')}]`);
  const runs = [];
  const commands = [];
  for (const t of tests) for (const seed of seeds) {
    if (o.token && o.token.isCancellationRequested) break;
    const rd = path.join(runBase, t, String(seed));
    fs.mkdirSync(rd, { recursive: true });
    const lf = path.join(rd, 'sim.log');
    // cocotb 2.x matches the filter against the full name (test_<top>.<test>); its Makefile pastes the value into a
    // shell line unquoted, so the regex must avoid shell metacharacters
    const envv = { COCOTB_TEST_FILTER: `.${t}$`, COCOTB_RANDOM_SEED: String(seed), RANDOM_SEED: String(seed), COCOTB_RESULTS_FILE: path.join(rd, 'results.xml'), COCOTB_ANSI_OUTPUT: '0', ...(o.iterations ? { ITERATIONS: String(o.iterations) } : {}) };
    const c = w.mode === 'container'
      ? { stage: 'simulate', cmd: 'ctr:make', args: ['-C', dir, `SIM=${simId}`], cwd: dir, ctrEnv: envv }
      : { stage: 'simulate', cmd: 'make', args: ['-C', dir, `SIM=${simId}`], cwd: dir };
    const shown = `make -C cocotb SIM=${simId} COCOTB_TEST_FILTER='.${t}$' COCOTB_RANDOM_SEED=${seed}`;
    if (!commands.length) commands.push(shown);
    const r = await runner.runProc(c, lf, (o.timeoutS || 600) * 1000, o.token, w.mode === 'local' ? Object.assign({}, process.env, envv) : null, simId);
    const text = fs.existsSync(lf) ? fs.readFileSync(lf, 'utf8') : '';
    const parsed = runner.parseSimLog(text);
    let status;
    if (r.killedBy === 'timeout') status = 'TIMEOUT';
    else if (r.killedBy === 'cancelled') status = 'CANCELLED';
    else if (parsed.result === 'PASS' && r.code === 0) status = 'PASS';
    else if (parsed.result === 'FAIL' || parsed.mismatches.length || parsed.missing.length) status = 'FAIL';
    else status = 'ERROR';
    const lines = text.split(/\r?\n/);
    // the exception line itself (not "Traceback ..."), else a compile / make error
    const errLine = (lines.find(l => /^\s*\w*(Error|Exception)\b.*:/.test(l) && !/^\s*Traceback/.test(l)) || lines.find(l => /DVFLOW_MISSING|error:|Error:|No tests? (were )?(found|run)/i.test(l) && !/DVFLOW_RESULT/.test(l)) || '').trim();
    const firstError = status === 'PASS' ? null : (parsed.mismatches[0] ? `${parsed.mismatches[0].signal} expected ${parsed.mismatches[0].expected} got ${parsed.mismatches[0].actual} @${parsed.mismatches[0].time}ns (${parsed.mismatches[0].scenario})` : errLine || `make exit code ${r.code}`);
    runs.push({ test: t, seed, dir: path.relative(runBase, rd).replace(/\\/g, '/'), status, time: Math.round((r.ms || 0) / 10) / 100, parsed, firstError, command: shown, waves: false });
    log(`[${status.padEnd(10)}] ${t} seed=${seed} (${((r.ms || 0) / 1000).toFixed(2)}s) checks=${parsed.checks}${status === 'PASS' ? '' : ' — ' + firstError}`);
  }
  const pass = runs.filter(r => r.status === 'PASS').length;
  let report = null;
  try {
    const pub = require('./external').publish(root, cfg, { kind: 'cocotb', runId, simId, det, started: new Date(t0).toISOString(), runs, build: { failed: runs.length > 0 && runs.every(r => r.status === 'ERROR'), errors: [], commands, log: runs[0] ? runs[0].dir + '/sim.log' : null } });
    report = pub.report;
    log(`   dashboard:       ${report}`);
    log(`   test plan:       ${require('./layout').planYaml(root)}`);
    if (pub.result.testplanXlsx) log(`   test plan Excel: ${pub.result.testplanXlsx}`);
    else if (pub.result.testplanError) log(`   # testplan.xlsx not written: ${pub.result.testplanError}`);
  } catch (e) { log('# dashboard not written: ' + e.message); }
  log(`== cocotb: ${pass}/${runs.length} passed · ${runBase}`);
  return { runId, runDir: runBase, sim: simId, runs, totals: { runs: runs.length, pass }, report, exitCode: pass === runs.length && runs.length ? 0 : runs.some(r => r.status === 'FAIL' || r.status === 'TIMEOUT') ? 1 : 2 };
}

module.exports = { run, listTests, where, SIMS };

#!/usr/bin/env node
'use strict';
/*
 * dvflow CLI — same engine as the 10xEngineers EDA extension.
 *   dvflow generate [--mode lightweight|uvm|both] [--yes]     (preview unless --yes)
 *   dvflow build    [--sim icarus] [--config default] [--cov both|code|functional|none]
 *   dvflow run      --test smoke --seed 1 [--count 100]   (count = number of runs: first seed, then random seeds)
 *   dvflow regress  --bug 1                   bug-injection demo: runs the buggy RTL from dvflow.json "bug_injection", passes when the bug is caught
 *   [--config c] [--waves 1] [--scenario SC-..] [--iterations n]
 *   dvflow regress  [--suite full] [--tests a,b] [--seeds 1,2,3] [--configs a,b] [--waves fail|1|0] [--cov both|code|functional|none]
 *   dvflow rerun    --run <id|latest> --test t --seed s [--config c] [--waves 1]
 *   dvflow report   [--run <id|latest>]       dvflow capabilities       dvflow clean
 *   dvflow uvm      --sim questa|vcs|verilator [--test smoke] [--seed 1] [--count n]   run the generated UVM testbench
 *   dvflow generate --mode cocotb|all   ·   dvflow cocotb [--sim icarus|verilator] [--tests a,b] [--seed 1]   Python (cocotb) testbench
 *   seeds (run / regress / uvm / cocotb): --seeds 7 | 1,5,9 | 0:100 | 0:100:10 | "random 50" | "1,2,10:20,random 5"
 *   dvflow init     --file <rtl.sv> [--top m] [--mode all]   one step from an RTL file to dvflow.json + every testbench
 *   dvflow signoff  [--steps lint,synth,lec,gls,formal] [--gls-sim icarus]   synthesis + gate-level sim + equivalence + formal proof
 *   dvflow mutate   [--sim icarus] [--max 40] [--tests a,b]   mutation testing: how many planted bugs does the testbench catch?
 *   dvflow toolchain [status|build|stop]   open-source tools in Docker  ·  --toolchain local|auto|container on any command
 *   dvflow check-tools [--sim questa] [--uvm 1] [--coverage 1] [--questa-bin <dir>]   installation + license smoke checks
 *   dvflow retry    [--run latest] [--sim s]  re-run the non-passing jobs with the same simulator, parameters and seeds
 *   dvflow simconfig [--sim questa --bin <dir> --license-file <f>]   per-user settings (~/.dvflow/simulators.json)
 *   --<sim>-bin <dir> on any command: installation or bin directory for that simulator (questa, verilator, ghdl, icarus, vcs)
 * Exit codes: 0 all passed · 1 test failures/timeouts · 2 incomplete/blocked/tool or compile errors · 3 usage/config error
 */
const fs = require('fs');
const path = require('path');
const runner = require('./runner');

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const has = argv[i + 1] != null && !argv[i + 1].startsWith('--'); const v = has ? argv[++i] : '1'; o[k] = v; if (has) (o._given = o._given || new Set()).add(k); }
    else o._.push(a);
  }
  return o;
}
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : null);
/** N seeds: the given one first, then random ones (all recorded, so every run can be reproduced). */
const seedList = (seed, count) => { const n = Math.max(1, Number(count) || 1); const out = [Number(seed || 1)]; while (out.length < n) { const s = 1 + Math.floor(Math.random() * 2147483646); if (!out.includes(s)) out.push(s); } return out; };
/**
 * Seeds from the command line: --seeds / --seed take "7", "1,5,9", "0:100", "0:100:10", "random 50" or a mix
 * (see seeds.js); the older "--seed N --count M" (N, then M-1 random seeds) still works.
 */
function seedsOf(a, fallback) {
  // a bare --seeds reads as '1'; an explicit '--seeds 1' means seed 1
  const spec = a.seeds && (a.seeds !== '1' || (a._given && a._given.has('seeds'))) ? a.seeds : (a.seed && /[:,.]|rand/i.test(a.seed) ? a.seed : null);
  if (spec) {
    const r = require('./seeds').parseSeeds(spec);
    if (r.error) throw Object.assign(new Error('--seeds ' + spec + ': ' + r.error), { exitCode: 3 });
    return r.seeds;
  }
  if (a.seed || a.count) return seedList(a.seed, a.count);
  return fallback || null;
}

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0] || 'help';
  const root = path.resolve(a.root || process.cwd());
  const log = s => console.log(s);
  const settings = {};
  const override = {};
  for (const id of ['questa', 'verilator', 'ghdl', 'icarus', 'vcs']) { const v = a[id + '-bin']; if (v && v !== '1') override[id] = { bin: v }; }
  const container = require('./container');
  container.configure({ roots: [root], ...(a.toolchain && a.toolchain !== '1' ? { mode: a.toolchain } : {}) });
  let cancelled = false;
  const token = { get isCancellationRequested() { return cancelled; } };
  process.on('SIGINT', () => { cancelled = true; console.log('\n# cancelling — partial logs are kept'); });
  switch (cmd) {
    case 'generate': {
      const cfg = runner.loadConfig(root);
      const { files } = runner.plannedFiles(root, cfg, { mode: a.mode, engineSrc: path.resolve(__dirname, '..'), runtime: process.env.DVFLOW_RUNTIME || (process.versions.electron ? process.execPath : undefined) });
      const changed = files.filter(f => f.changed);
      changed.forEach(f => log(`${f.exists ? 'M' : 'A'} ${f.path}`));
      if (!a.yes) { log(`\n${changed.length} file(s) would change. Re-run with --yes to write them.`); return 0; }
      runner.writeFiles(files);
      log(`wrote ${changed.length} file(s)`);
      if (files.xlsx) log(`A ${path.relative(root, files.xlsx)}  (Excel test plan)`);
      if (files.xlsxError) log(`testplan.xlsx not written: ${files.xlsxError}`);
      if (files.movedPlan) log('[layout] the test plan is now in testplan/ (testplan.yaml + testplan.xlsx)');
    if (files.retiredUvm && files.retiredUvm.length) log(`[layout] UVM files are now in uvm/tb, agent, sequences, env, tests, scripts; the old flat copies (${files.retiredUvm.length}) are in uvm/_old_flat_layout/`);
      return 0;
    }
    case 'build': { const r = await runner.regress(root, { sim: a.sim, configs: csv(a.config || a.configs), cov: a.cov, buildOnly: true, log, token, settings, override }); return r.builds.some(b => b.failed) ? 2 : 0; }
    case 'run': {
      if (!a.test) { log('run needs --test'); return 3; }
      const r = await runner.regress(root, { sim: a.sim, tests: [a.test], seeds: seedsOf(a, [1]), bug: a.bug === '1', configs: csv(a.config), waves: a.waves, cov: a.cov, scenario: a.scenario, iterations: a.iterations, timeoutS: a.timeout && Number(a.timeout), log, token, settings, override, suite: 'single' });
      return r.exitCode;
    }
    case 'regress': {
      const r = await runner.regress(root, { sim: a.sim, suite: a.suite, tests: csv(a.tests), seeds: a.count && !(a.seeds && /[:]|rand/i.test(a.seeds)) ? seedList(csv(a.seeds) ? csv(a.seeds)[0] : 1, a.count) : seedsOf(a), bug: a.bug === '1', configs: csv(a.configs || (a.config && a.config !== 'default' ? a.config : null)), waves: a.waves, cov: a.cov, timeoutS: a.timeout && Number(a.timeout), log, token, settings, override });
      if (a.json) fs.writeFileSync(a.json, JSON.stringify(r, null, 2));
      if (a.junit) fs.writeFileSync(a.junit, runner.junit(r));
      return r.exitCode;
    }
    case 'rerun': {
      if (!a.test || !a.seed) { log('rerun needs --test and --seed'); return 3; }
      const r = await runner.rerun(root, { run: a.run || 'latest', sim: a.sim, test: a.test, seed: a.seed, config: a.config, waves: a.waves, log, token, settings, override });
      return r.exitCode;
    }
    case 'report': {
      const id = !a.run || a.run === 'latest' ? fs.readFileSync(path.join(root, 'runs', 'latest.txt'), 'utf8').trim() : a.run;
      const res = JSON.parse(fs.readFileSync(path.join(root, 'runs', id, 'results.json'), 'utf8'));
      log(require('./report').write(root, res));
      return 0;
    }
    case 'check-tools': case 'doctor': {
      const sim = require('./sim');
      let simId = a.sim;
      let uvm = a.uvm === '1', coverage = a.coverage === '1' || a.cov === '1';
      try { const cfg = runner.loadConfig(root); simId = simId || cfg.simulator; uvm = uvm || cfg.mode === 'uvm' || cfg.mode === 'both'; coverage = coverage || !!cfg.options.code_coverage; } catch (e) { /* doctor works outside a project too */ }
      simId = simId || 'icarus';
      log(`== tools check: ${simId}${uvm ? ' +uvm' : ''}${coverage ? ' +coverage' : ''} (per-user settings: ${sim.USER_FILE})`);
      const d = sim.doctor(simId, { override: override[simId], uvm, coverage });
      for (const s of d.stages) {
        log(`[${s.ok ? 'PASS' : 'FAIL'}] ${s.stage}`);
        if (s.detail) log(s.detail.split('\n').map(x => '       ' + x).join('\n'));
        if (!s.ok && s.next) log('       NEXT: ' + s.next);
      }
      log(d.ok ? `tools check: ${simId} is ready` : `tools check: ${simId} is NOT ready (see NEXT above)`);
      return d.ok ? 0 : 2;
    }
    case 'retry': {
      const r = await runner.retry(root, { run: a.run || 'latest', sim: a.sim, waves: a.waves, cov: a.cov, log, token, settings, override });
      return r.exitCode;
    }
    case 'simconfig': {
      const sim = require('./sim');
      const u = sim.loadUser();
      if (a.sim && (a.bin || a['license-file'] || a['license-server'])) {
        u[a.sim] = u[a.sim] || {};
        if (a.bin) u[a.sim].bin = a.bin;
        if (a['license-file'] || a['license-server']) { u[a.sim].license = u[a.sim].license || {}; u[a.sim].license[a.sim === 'vcs' ? 'SNPSLMD_LICENSE_FILE' : (a.sim === 'questa' ? 'MGLS_LICENSE_FILE' : 'LM_LICENSE_FILE')] = a['license-file'] || a['license-server']; }
        sim.saveUser(u);
      }
      log(`per-user simulator settings: ${sim.USER_FILE}`);
      log(sim.redact(JSON.stringify(u, (k, v) => (k === 'license' && v ? Object.fromEntries(Object.keys(v).map(x => [x, '<set, hidden>'])) : v), 2)));
      return 0;
    }
    case 'formal': {
      const cfg = runner.loadConfig(root);
      const fj = await require('./formal').run(root, cfg, { only: csv(a.only), log });
      fj.results.forEach(r => log(`${r.name.padEnd(24)} ${r.status.padEnd(8)} ${r.label}${r.trace ? '  trace: ' + r.trace : ''}`));
      return fj.results.every(r => r.status === 'PASS') ? 0 : fj.results.some(r => r.status === 'FAIL') ? 1 : 2;
    }
    case 'capabilities': {
      for (const c of require('./sim').capabilities(override)) {
        log(`${c.label.padEnd(20)} ${c.available ? 'available  ' + c.version : 'UNAVAILABLE ' + c.reason}`);
        log('  ' + Object.entries(c.caps).map(([k, v]) => `${k}=${v}`).join('  '));
      }
      return 0;
    }
    case 'uvm': {
      // dvflow uvm --sim questa|vcs|verilator [--test smoke|<class>] [--tests a,b] [--seed 1] [--count n]
      const cfg = runner.loadConfig(root);
      const r = await require('./uvmrun').run(root, cfg, { sim: a.sim, tests: csv(a.tests) || (a.test ? [a.test] : null), seeds: seedsOf(a, [1]), cov: a.cov, timeoutS: a.timeout && Number(a.timeout), log, token, override });
      return r.exitCode;
    }
    case 'init': {
      // dvflow init --file adder.sv [--top adder4] [--mode all|both|lightweight|uvm|cocotb]   RTL file -> project in one step
      if (!a.file || a.file === '1') { log('init needs --file <rtl.sv>'); return 3; }
      const r = require('./demo').init(root, a.file, { top: a.top, mode: a.mode || 'all', engineSrc: path.resolve(__dirname, '..'), runtime: process.env.DVFLOW_RUNTIME || (process.versions.electron ? process.execPath : undefined) });
      log(`dvflow.json: ${r.cfg.dut.top}, template "${r.cfg.template}", ${r.model.scenarios.length} scenarios, ${r.model.bins.length} coverage bins`);
      log(`wrote ${r.files.length} file(s): ${r.files.filter(f => !f.startsWith('.dvflow')).join(', ')}`);
      return 0;
    }
    case 'signoff': {
      // dvflow signoff [--steps lint,synth,lec,gls,formal] [--gls-sim icarus|verilator]   synthesis, gate-level sim, LEC, formal
      const r = await require('./signoff').run(root, { steps: csv(a.steps), glsSim: a['gls-sim'], log, token, override });
      return r.verdict === 'fail' ? 1 : 0;
    }
    case 'cocotb': {
      // dvflow cocotb [--sim icarus|verilator] [--tests a,b] [--seed 1] [--count n]   run the generated cocotb testbench
      const cfg = runner.loadConfig(root);
      const r = await require('./cocotbrun').run(root, cfg, { sim: a.sim, tests: csv(a.tests) || (a.test ? [a.test] : null), seeds: seedsOf(a, [1]), iterations: a.iterations, log, token });
      return r.exitCode;
    }
    case 'mutate': {
      // dvflow mutate [--sim icarus] [--max 40] [--tests a,b] [--seed 1]   testbench quality: plant bugs, see which are caught
      const r = await require('./mutate').run(root, { sim: a.sim, max: a.max && Number(a.max), tests: csv(a.tests), seeds: a.seed ? [Number(a.seed)] : null, log, token, override });
      return r.survived ? 1 : 0;
    }
    case 'toolchain': {
      // dvflow toolchain [status|pull|update|check|smoke|build|stop]   open-source tools in the 10xEngineers EDA container image
      const sub = a._[1] || 'status';
      if (sub === 'stop') { log(`removed ${container.stopAll()} toolchain container(s)`); return 0; }
      // pull: download the image now (what a first run does) · update: newer compatible tag, smoke test, switch · check: list
      if (sub === 'pull') { try { const r = await container.ensureImage({ log, token }); log(r.fallback ? `using ${r.image} (fallback)` : `ready: ${r.image}`); log(container.describe()); return r.fallback ? 2 : 0; } catch (e) { log('error: ' + e.message); return 2; } }
      if (sub === 'update') { try { const r = await container.update({ log, token }); log(r.updated ? `updated: ${r.from} -> ${r.image}` : `not updated (${r.reason}); using ${r.image}`); return r.updated || r.reason === 'up to date' ? 0 : 2; } catch (e) { log('error: ' + e.message); return 2; } }
      if (sub === 'check') { const r = await container.checkForUpdate({ force: true }); log(JSON.stringify(r, null, 2)); return r.error ? 2 : 0; }
      if (sub === 'smoke') { const r = await container.smoke(container.config().image, log, token); log(r.ok ? 'SMOKE PASS' : 'SMOKE FAIL'); return r.ok ? 0 : 2; }
      if (sub === 'build') {
        const ctx = path.resolve(__dirname, '..', '..', 'container');
        if (!fs.existsSync(path.join(ctx, 'Dockerfile'))) { log('Dockerfile not found at ' + ctx); return 3; }
        log(`building ${container.config().image} from ${ctx} …`);
        return await new Promise(res => container.build(ctx, d => process.stdout.write(d)).on('close', c => res(c === 0 ? 0 : 2)));
      }
      const s = container.status();
      log(`mode:      ${s.mode}`);
      log(`engine:    ${s.engine.error ? 'NOT AVAILABLE — ' + s.engine.error : s.engine.label}`);
      log(`image:     ${s.image} ${s.imageInfo.present ? '(present)' : '(not built — run: dvflow toolchain build)'}`);
      log(`container: ${s.container} ${s.running ? '(running)' : '(stopped)'}`);
      log(`mounts:    ${s.mounts.join(', ')}`);
      if (s.imageInfo.present) Object.entries(s.imageInfo.tools || {}).forEach(([k, v]) => log(`  ${k.padEnd(10)} ${v || '-'}`));
      return s.engine.error || !s.imageInfo.present ? 2 : 0;
    }
    case 'clean': runner.clean(root); log('removed runs/'); return 0;
    default:
      log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 21).map(l => l.replace(/^ \* ?/, '')).join('\n'));
      return cmd === 'help' ? 0 : 3;
  }
}

main().then(code => { process.exitCode = code; }, e => { console.error('dvflow: ' + (e && e.message || e)); process.exitCode = e && e.exitCode || 3; });

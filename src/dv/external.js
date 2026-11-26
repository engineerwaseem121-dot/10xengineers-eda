'use strict';
/*
 * Publish runs of the UVM and cocotb testbenches in the same form as a DV regression, so they get the full dashboard
 * (Overview, Runs + log + waveform, Coverage, Traceability, Failures, History/Compare) and results.json / junit.xml.
 *
 * publish(root, cfg, o)
 *   o.kind      'uvm' | 'cocotb'
 *   o.runId     folder name under runs/
 *   o.det       sim.detect() result of the simulator used
 *   o.runs      [{ test, seed, dir (relative to the run folder), status, time, parsed, firstError, command, waves }]
 *   o.build     { failed, errors, log (relative), commands }
 *   o.codeCov   optional coverage result (qcov / vcov shape)
 */
const fs = require('fs');
const path = require('path');
const runner = require('./runner');
const tb = require('./tbgen');
const sim = require('./sim');

/** reference model / scenarios / requirements of the project (same as the SV testbench) */
function projectModel(root, cfg) {
  try {
    const dut = tb.resolveDut(cfg, root, {}, f => fs.readFileSync(f, 'utf8'));
    return tb.buildModel(cfg, dut.ports, dut.paramValues);
  } catch (e) { return null; }
}

/** an empty parsed-log record (runner.parseSimLog shape) */
function emptyParsed() { return { result: null, errors: 0, checks: 0, reason: '', mismatches: [], missing: [], timeout: null, scenarios: {}, bins: {}, asserts: [], license: false, licenseLines: [], firstError: null }; }

/** scenario attribution for a test that does not print per-scenario lines (UVM): its scenarios share its checks */
function attribute(model, lwTest, all, checks, fails) {
  const sc = {};
  if (!model) return sc;
  const mine = model.scenarios.filter(s => all || s.test === lwTest);
  for (const s of model.scenarios) sc[s.id] = { ran: mine.includes(s) ? 1 : 0, checks: mine.includes(s) ? checks : 0, fails: mine.includes(s) && fails ? 1 : 0 };
  return sc;
}

function publish(root, cfg, o) {
  const runDir = path.join(root, 'runs', o.runId);
  const model = projectModel(root, cfg);
  const det = o.det || {};
  const caps = det.caps || {};
  const runs = o.runs.map(r => Object.assign({ config: 'default', params: {}, code: r.status === 'PASS' ? 0 : 1 }, r, {
    classification: r.status === 'PASS' ? null : { kind: r.status === 'TIMEOUT' ? 'timeout' : r.status === 'FAIL' ? 'mismatch' : 'tool', label: r.status === 'FAIL' ? (o.kind === 'uvm' ? 'UVM error' : 'Check failed') : r.status === 'TIMEOUT' ? 'Timeout' : 'Tool / build issue', stage: r.status === 'FAIL' ? 'test' : 'simulate' },
    signature: r.status === 'FAIL' || r.status === 'TIMEOUT' ? String(r.firstError || r.status).replace(/\d+/g, 'N').slice(0, 120) : null
  }));
  const meta = {
    runId: o.runId, kind: o.kind, started: o.started || new Date().toISOString(), finished: new Date().toISOString(), root, dut: cfg.dut.top, template: cfg.template, language: 'sv',
    simulator: det.adapter ? det.adapter.id : o.simId, simRequested: o.simId, simLabel: det.adapter ? det.adapter.label : o.simId, simVersion: det.version || '', simAvailable: true, simReason: '', simSource: det.source || '',
    rev: 'unavailable', suite: o.kind === 'uvm' ? 'UVM' : 'cocotb', tests: [...new Set(o.runs.map(r => r.test))], seeds: [...new Set(o.runs.map(r => r.seed))], configs: ['default'],
    waves: o.runs.some(r => r.waves), coverage: { code: !!(o.codeCov && (!o.covModes || o.covModes.code)), functional: !o.covModes || o.covModes.functional, mode: o.covModes ? (o.covModes.code && o.covModes.functional ? 'both' : o.covModes.code ? 'code' : o.covModes.functional ? 'functional' : 'none') : 'functional', assertions: false },
    capabilities: Object.assign({}, caps, o.kind === 'cocotb' ? { simulator_covergroups: 'unsupported' } : {}), unsupported: [], scenarioFilter: null, host: require('os').hostname(),
    request: { sim: o.simId, suite: o.kind, tests: [...new Set(o.runs.map(r => r.test))] }, codeCov: o.codeCov || null,
    testbench: o.kind === 'uvm' ? 'UVM testbench (uvm/)' : 'cocotb testbench (cocotb/)'
  };
  const build = Object.assign({ config: 'default', params: {}, failed: false, blocked: false, errors: [], commands: [], log: null }, o.build || {});
  const result = runner.assemble(root, cfg, meta, runs, { default: Object.assign({ dir: runDir }, build) }, model);
  result.builds = [{ config: 'default', params: {}, failed: !!build.failed, blocked: false, errors: build.errors || [], commands: build.commands || [], log: build.log }];
  // these testbenches have no per-bin sampling in the log: say why instead of reporting 0%
  if (!runs.some(r => r.parsed && Object.keys(r.parsed.bins || {}).length)) {
    const f = result.coverage.types.find(t => /^Functional/.test(t.type));
    if (f && f.state !== 'reported' && f.state !== 'disabled') { f.state = 'unavailable'; f.note = o.kind === 'uvm' ? 'the UVM testbench samples covergroups (Questa / VCS); testbench bins come from the simple testbench' : 'the cocotb testbench checks behaviour; bins come from the simple testbench'; }
  }
  const text = sim.redact(JSON.stringify(result, null, 2), meta.simulator);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'results.json'), text);
  fs.writeFileSync(path.join(runDir, 'junit.xml'), runner.junit(result));
  const report = require('./report').write(root, JSON.parse(text));
  // the test plan follows every run, UVM and cocotb included: testplan.yaml results block + testplan.xlsx
  if (!o.quiet) {
    try {
      const tp = require('./layout').planYaml(root);
      if (fs.existsSync(tp)) fs.writeFileSync(tp, require('./testplan').updateResults(fs.readFileSync(tp, 'utf8'), JSON.parse(text), path.relative(root, runDir).split(path.sep).join('/')));
      result.testplanXlsx = require('./planxlsx').write(root, JSON.parse(text));
    } catch (e) { result.testplanError = e.message; }
  }
  return { result, report };
}

/** UVM sim.log -> parsed record: scoreboard summary, first UVM_ERROR/FATAL, report counts */
function parseUvmLog(text, model, lwTest, all) {
  const p = emptyParsed();
  const sb = /seen=(\d+)\s+match=(\d+)\s+mismatch=(\d+)/.exec(text);
  const e = /UVM_ERROR\s*:\s*(\d+)/.exec(text), f = /UVM_FATAL\s*:\s*(\d+)/.exec(text);
  p.checks = sb ? +sb[1] : 0;
  p.errors = (sb ? +sb[3] : 0) || ((e ? +e[1] : 0) + (f ? +f[1] : 0));
  p.result = e && f ? (+e[1] + +f[1] === 0 ? 'PASS' : 'FAIL') : null;
  const first = String(text).split(/\r?\n/).find(l => /UVM_(ERROR|FATAL)\s+\S+\(\d+\)|UVM_(ERROR|FATAL) @/.test(l));
  p.firstError = first ? first.trim() : null;
  p.scenarios = attribute(model, lwTest, all, p.checks, p.errors);
  return p;
}

module.exports = { publish, projectModel, parseUvmLog, emptyParsed, attribute };

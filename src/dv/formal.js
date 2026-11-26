'use strict';
/*
 * Formal verification with SymbiYosys (sby).
 * The SymbiYosys verdict is kept as-is — PASS, FAIL (counterexample found), UNKNOWN (engine could not decide),
 * TIMEOUT, ERROR — instead of collapsing everything that is not PASS into "failed".
 * Only a genuine refutation (FAIL with a trace) offers a counterexample.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const VERDICTS = {
  PASS: { verdict: 'pass', label: 'proved / no counterexample within bound', state: 'passed' },
  FAIL: { verdict: 'counterexample', label: 'counterexample found', state: 'failed' },
  UNKNOWN: { verdict: 'unknown', label: 'engine could not decide', state: 'errored' },
  TIMEOUT: { verdict: 'timeout', label: 'timed out', state: 'errored' },
  ERROR: { verdict: 'error', label: 'tool error', state: 'errored' }
};

function findSby() {
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    for (const n of ['sby', 'sby.exe', 'sby.bat']) { const p = path.join(d, n); try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* next */ } }
  }
  return null;
}

/** Parse SymbiYosys output (stdout or the workdir logfile.txt). */
function parseSby(text, workdir) {
  const lines = String(text || '').split(/\r?\n/);
  const r = { status: null, rc: null, trace: null, traces: [], props: [], lines: [] };
  lines.forEach((l, i) => {
    let m;
    if ((m = /DONE \((PASS|FAIL|UNKNOWN|TIMEOUT|ERROR), rc=(\d+)\)/.exec(l))) { r.status = m[1]; r.rc = +m[2]; r.doneLine = i + 1; }
    else if ((m = /(?:Writing trace to VCD file|counterexample trace(?: \[\w+\])?):\s*(\S+\.vcd)/i.exec(l))) { r.traces.push(m[1]); r.trace = r.trace || m[1]; }
    else if ((m = /Assert(?:ion)? failed in (\S+?):\s*(\S+?):(\d+)(?:\.(\d+))?/i.exec(l)) || (m = /failed assertion (\S+?)\s+at\s+(\S+?):(\d+)(?:\.(\d+))?/i.exec(l))) r.props.push({ module: m[1], file: m[2], line: +m[3], col: m[4] ? +m[4] : 1, logLine: i + 1 });
  });
  if (r.trace && workdir && !path.isAbsolute(r.trace)) {
    const cands = [path.join(workdir, r.trace), path.join(path.dirname(workdir), r.trace)];
    r.traceAbs = cands.find(p => fs.existsSync(p)) || cands[0];
  } else if (r.trace) r.traceAbs = r.trace;
  return r;
}

/** Run every formal entry of a project (dvflow.json "formal": [{name, sby, task?, timeout_s?}]). */
async function run(root, cfg, o) {
  o = o || {};
  const log = o.log || (() => {});
  const items = (cfg.formal || []).filter(f => !o.only || o.only.includes(f.name));
  let sby = o.sbyBin || findSby();
  // no local SymbiYosys: use the container toolchain (sby + yosys + z3/boolector) when it is set up
  if (!sby) { try { const ct = require('./container'); ct.configure({ roots: [root] }); if (ct.canRun([root])) sby = 'ctr:sby'; } catch (e) { /* keep null */ } }
  const out = { host: os.hostname(), sby: sby || null, started: new Date().toISOString(), results: [] };
  for (const f of items) {
    const sbyFile = path.resolve(root, f.sby);
    const dir = path.dirname(sbyFile);
    const base = path.basename(sbyFile, '.sby');
    const workdir = path.join(dir, f.task ? `${base}_${f.task}` : base);
    const res = { name: f.name, sby: f.sby, task: f.task || null, workdir: path.relative(root, workdir).replace(/\\/g, '/'), host: out.host };
    if (!sby) { Object.assign(res, { status: 'ERROR', verdict: 'error', label: 'SymbiYosys (sby) not found on PATH', state: 'errored', blocked: true }); out.results.push(res); log(`[formal] ${f.name}: sby not found`); continue; }
    log(`[formal] ${f.name}: sby -f ${f.sby}${f.task ? ' ' + f.task : ''}`);
    const t0 = Date.now();
    let cmd = sby, args = ['-f', sbyFile, ...(f.task ? [f.task] : [])], cwd = dir;
    if (sby === 'ctr:sby') { const w = require('./container').wrap({ cmd: sby, args, cwd: dir }); cmd = w.cmd; args = w.args; cwd = w.cwd; }
    const p = cp.spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: (f.timeout_s || 1800) * 1000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    const text = (p.stdout || '') + (p.stderr || '');
    fs.mkdirSync(workdir, { recursive: true });
    fs.writeFileSync(path.join(workdir, 'dvflow_sby.log'), text);
    const parsed = parseSby(text, workdir);
    const status = parsed.status || (p.error && /ETIMEDOUT/.test(p.error.code || '') ? 'TIMEOUT' : 'ERROR');
    const v = VERDICTS[status];
    Object.assign(res, { status, verdict: v.verdict, label: v.label, state: v.state, duration_s: Math.round((Date.now() - t0) / 100) / 10, log: path.relative(root, path.join(workdir, 'dvflow_sby.log')).replace(/\\/g, '/'), property: parsed.props[0] || null, trace: status === 'FAIL' && parsed.traceAbs ? path.relative(root, parsed.traceAbs).replace(/\\/g, '/') : null });
    out.results.push(res);
    log(`[formal] ${f.name}: ${status} — ${v.label}${res.trace ? ' — trace ' + res.trace : ''}`);
  }
  out.finished = new Date().toISOString();
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runs', 'formal.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(root, 'runs', 'formal.ndjson'), out.results.map(r => JSON.stringify({ suite: 'formal', test: r.name, status: r.status, verdict: r.verdict, duration_s: r.duration_s || 0, message: r.label, counterexample: r.trace, host: r.host })).join('\n') + '\n');
  return out;
}

module.exports = { run, parseSby, VERDICTS, findSby };

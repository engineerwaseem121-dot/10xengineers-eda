'use strict';
/*
 * Run an open-source tool (yosys, verilator, sby, …): the local install when it is on PATH, otherwise the container
 * toolchain. One place for "where does this tool come from", used by synthesis, LEC, lint and sign-off.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const onPath = n => (process.env.PATH || '').split(path.delimiter).some(d => d && fs.existsSync(path.join(d, IS_WIN ? n + '.exe' : n)));
const LOCAL_NAME = { verilator: IS_WIN ? 'verilator_bin' : 'verilator' };

/** where a tool runs: 'local' | 'container' | null */
function where(root, tool) {
  if (onPath(LOCAL_NAME[tool] || tool)) return 'local';
  try { const ct = require('./container'); ct.configure({ roots: [root] }); if (ct.canRun([root])) return 'container'; } catch (e) { /* none */ }
  return null;
}

/** synchronous run; paths in args may be Windows paths (translated for the container) */
function run(root, tool, args, cwd, timeoutMs) {
  const w = where(root, tool);
  if (!w) return { code: -1, out: '', where: null, error: `${tool} is not installed and the container toolchain is not set up` };
  let cmd = tool, a = args, c = cwd || root;
  if (w === 'container') { const x = require('./container').wrap({ cmd: 'ctr:' + tool, args, cwd: c }); cmd = x.cmd; a = x.args; c = x.cwd; }
  const r = cp.spawnSync(cmd, a, { cwd: c, encoding: 'utf8', windowsHide: true, timeout: timeoutMs || 600000, maxBuffer: 128 * 1024 * 1024 });
  return { code: r.error ? -1 : r.status, out: (r.stdout || '') + (r.stderr || ''), where: w, error: r.error ? r.error.message : null };
}

/** a Yosys script string with Windows paths converted when it runs in the container */
function yosysScript(root, script) {
  return where(root, 'yosys') === 'container' ? require('./container').mapText(script) : script;
}

module.exports = { where, run, yosysScript };

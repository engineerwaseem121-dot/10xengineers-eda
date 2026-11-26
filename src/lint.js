'use strict';
/* Thin wrapper around Verilator (--lint-only) and Icarus Verilog (-t null). */
const cp = require('child_process');
const path = require('path');

function run(cmd, args, cwd, timeout = 30000) {
  if (String(cmd).startsWith('ctr:')) {
    // container toolchain: same output, paths inside it are the Linux form of the host paths
    return require('./dv/container').execAsync(cmd.slice(4), args, cwd, timeout + 30000).then(r => ({ err: r.code ? { code: r.code } : null, out: r.out + '\n' + r.err }));
  }
  return new Promise(resolve => {
    cp.execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, out: (stdout || '') + '\n' + (stderr || '') });
    });
  });
}

const availCache = new Map();
async function available(cmd, flag) {
  const k = cmd + ' ' + flag;
  if (!availCache.has(k)) {
    const r = await run(cmd, [flag], undefined, 8000);
    availCache.set(k, !(r.err && (r.err.code === 'ENOENT' || r.err.code === 'EACCES')));
  }
  return availCache.get(k);
}

function samePath(a, b) {
  const n = p => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  return n(a) === n(b) || path.basename(a).toLowerCase() === path.basename(b).toLowerCase();
}

async function resolveTool(cfg) {
  const tool = cfg.get('lint.tool', 'auto');
  if (tool === 'none') return null;
  const ver = cfg.get('lint.verilatorPath', 'verilator');
  const iv = cfg.get('lint.iverilogPath', 'iverilog');
  const sl = cfg.get('lint.slangPath', 'slang');
  if ((tool === 'auto' || tool === 'slang') && await available(sl, '--version')) return { kind: 'slang', cmd: sl };
  if ((tool === 'auto' || tool === 'verilator') && await available(ver, '--version')) return { kind: 'verilator', cmd: ver };
  if (tool === 'auto' || tool === 'iverilog') {
    // Not on PATH: try the standard install folders (the same ones the DV flow checks).
    const dirs = iv !== 'iverilog' ? [] : process.platform === 'win32' ? ['C:\\iverilog\\bin', 'C:\\Program Files\\iverilog\\bin'] : ['/usr/local/bin', '/opt/homebrew/bin'];
    for (const c of [iv].concat(dirs.map(d => path.join(d, process.platform === 'win32' ? 'iverilog.exe' : 'iverilog')))) {
      if (await available(c, '-V')) return { kind: 'iverilog', cmd: c };
    }
  }
  return tool === 'auto' ? null : { kind: 'missing', cmd: tool === 'verilator' ? ver : iv };
}

async function lintFile(file, cfg) {
  let tool = await resolveTool(cfg);
  // nothing installed locally: lint with Verilator from the container toolchain (when set up and the file is mounted)
  const want = cfg.get('lint.tool', 'auto');
  if ((!tool || tool.kind === 'missing') && (want === 'auto' || want === 'verilator')) {
    try { if (require('./dv/container').canRun([file])) tool = { kind: 'verilator', cmd: 'ctr:verilator' }; } catch (e) { /* keep */ }
  }
  if (!tool) return { tool: null, items: [] };
  if (tool.kind === 'missing') return { tool: tool.cmd, missing: true, items: [] };
  const dir = path.dirname(file);
  const extra = cfg.get('lint.extraArgs', []) || [];
  const items = [];
  if (tool.kind === 'slang') {
    // use the project's file list when there is one, so packages / includes / other modules resolve
    const fs = require('fs');
    let flist = null;
    for (let d = dir, k = 0; k < 4 && !flist; k++, d = path.dirname(d)) for (const n of ['files.f', 'src_files.list']) if (fs.existsSync(path.join(d, n))) { flist = path.join(d, n); break; }
    const args = flist ? ['-f', flist, '--ignore-unknown-modules', ...extra] : ['--ignore-unknown-modules', '-I', dir, ...extra, file];
    const r = await run(tool.cmd, args, flist ? path.dirname(flist) : dir);
    const re = /^(.+?):(\d+):(\d+):\s*(error|warning|note):\s*(.*?)(?:\s*\[(-W[\w-]+)\])?$/gm;
    let m;
    while ((m = re.exec(r.out))) {
      if (m[4] === 'note' || !samePath(path.resolve(flist ? path.dirname(flist) : dir, m[1]), file)) continue;
      items.push({ severity: m[4], code: m[6] || '', line: +m[2] - 1, col: +m[3] - 1, message: m[5] });
    }
    return { tool: 'slang', items };
  }
  if (tool.kind === 'verilator') {
    const r = await run(tool.cmd, ['--lint-only', '-Wno-fatal', '--bbox-unsup', '-I' + dir, ...extra, file], dir);
    const re = /^%(Error|Warning)(?:-([A-Z0-9_]+))?:\s*(.+?):(\d+):(?:(\d+):)?\s*(.*)$/gm;
    let m;
    while ((m = re.exec(r.out))) {
      if (!samePath(m[3], file)) continue;
      items.push({ severity: m[1] === 'Error' ? 'error' : 'warning', code: m[2] || '', line: +m[4] - 1, col: m[5] ? +m[5] - 1 : 0, message: m[6] });
    }
  } else {
    // Icarus cannot parse verification-only SystemVerilog (UVM, classes, concurrent SVA, clocking blocks, covergroups).
    // Linting such a file with it gives only false errors, so skip it and say why.
    const src = require('fs').readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    const unsup = /`uvm_|`include\s+"uvm|\bimport\s+uvm_pkg\b/.test(src) ? 'UVM'
      : /\b(assert|assume|cover|restrict)\s+property\b|^\s*(property|sequence)\s+\w+/m.test(src) ? 'concurrent SVA'
      : /\bclass\s+\w+/.test(src) ? 'classes'
      : /\bclocking\b|\bcovergroup\b|\bmodport\b/.test(src) ? 'interfaces/clocking/covergroups' : null;
    if (unsup) return { tool: tool.kind, items: [], skipped: `Icarus Verilog cannot parse ${unsup}; lint this file with slang, Verilator or Questa instead` };
    const r = await run(tool.cmd, ['-g2012', '-t', 'null', '-I', dir, ...extra, file], dir);
    const re = /^(.+?):(\d+):\s*(?:(error|warning|sorry):\s*)?(.*)$/gim;
    let m;
    while ((m = re.exec(r.out))) {
      if (!samePath(m[1], file)) continue;
      // modules defined in other files are not a defect of this file
      if (/Unknown module type/i.test(m[4] || '')) continue;
      const sev = (m[3] || '').toLowerCase() === 'warning' ? 'warning' : 'error';
      items.push({ severity: sev, code: '', line: +m[2] - 1, col: 0, message: m[4] || 'error' });
    }
  }
  return { tool: tool.kind, items };
}

module.exports = { lintFile };

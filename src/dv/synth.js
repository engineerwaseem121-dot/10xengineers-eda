'use strict';
/*
 * Synthesis, logic-equivalence and lint for the DUT (open-source tools, local or container):
 *   synthesize(root, cfg, outDir)  Yosys generic synthesis -> netlist.v (gate-level simulation), netlist.json (schematic),
 *                                  cells / flip-flops / latches / logic depth / problems found by `check`
 *   lec(root, cfg, netlist)        RTL vs netlist, formally (Yosys equiv_*)
 *   lint(root, cfg)                Verilator --lint-only -Wall on the DUT files
 */
const fs = require('fs');
const path = require('path');
const tools = require('./tools');

const q = p => `"${String(p).replace(/\\/g, '/')}"`;
const abs = (root, f) => path.resolve(root, f);

function reads(root, cfg, files) {
  const inc = (cfg.dut.incdirs || []).map(d => ` -I${q(abs(root, d))}`).join('');
  return (files || cfg.dut.files.map(f => abs(root, f))).map(f => `read_verilog -sv -defer${inc} ${q(f)}`).join('; ');
}
const chparams = cfg => Object.entries(cfg.dut.params || {}).map(([k, v]) => ` -chparam ${k} ${v}`).join('');

/** parse `stat` output: { cells, wires, byType: {type: n} } */
function parseStat(text) {
  const out = { cells: null, wires: null, wireBits: null, byType: {} };
  const blocks = String(text).split(/Printing statistics\./);
  const last = blocks[blocks.length - 1] || '';
  let m;
  if ((m = /Number of cells:\s+(\d+)/.exec(last))) out.cells = +m[1];
  if ((m = /Number of wires:\s+(\d+)/.exec(last))) out.wires = +m[1];
  if ((m = /Number of wire bits:\s+(\d+)/.exec(last))) out.wireBits = +m[1];
  const re = /^\s+(\$\S+|\\?\w+)\s+(\d+)\s*$/gm;
  while ((m = re.exec(last.split(/Number of cells:\s+\d+/)[1] || ''))) out.byType[m[1]] = +m[2];
  return out;
}

function synthesize(root, cfg, outDir, log) {
  log = log || (() => {});
  fs.mkdirSync(outDir, { recursive: true });
  const top = cfg.dut.top;
  const nl = path.join(outDir, `${top}_netlist.v`), js = path.join(outDir, `${top}_netlist.json`);
  const script = [
    reads(root, cfg), `hierarchy -check -top ${top}${chparams(cfg)}`, 'proc', 'check', `synth -flatten -top ${top}`, 'opt_clean -purge',
    'check', 'stat', 'ltp -noff', `write_verilog -noattr ${q(nl)}`, `write_json ${q(js)}`
  ].join('; ');
  const w = tools.where(root, 'yosys');
  if (!w) return { state: 'unavailable', message: 'Yosys is not installed and the container toolchain is not set up' };
  log(`[synth] yosys ${w === 'container' ? '(container)' : '(local)'}: synth -flatten -top ${top}`);
  const t0 = Date.now();
  const r = tools.run(root, 'yosys', ['-p', tools.yosysScript(root, script)], root, 600000);
  fs.writeFileSync(path.join(outDir, 'yosys.log'), r.out || r.error || '');
  const latchOf = txt => [...new Set((String(txt).match(/Latch inferred for signal `([^']+)'/g) || []).map(x => x.replace(/^.*`/, '').replace(/'$/, '').split('.').pop().replace(/^\\/, '')))];
  if (r.code !== 0 || !fs.existsSync(nl)) {
    const err = (r.out.split(/\r?\n/).find(l => /ERROR/.test(l)) || r.error || `exit ${r.code}`).trim();
    // always_comb that infers a latch is an error in Yosys: report it as the design bug it is
    const latchSignals = latchOf(r.out);
    const message = latchSignals.length ? `latch inferred in combinational logic for ${latchSignals.join(', ')} (always_comb / always @* that does not assign it on every path)` : err;
    log(`[synth] FAILED: ${message}`);
    return { state: 'failed', message, latchSignals, log: path.join(outDir, 'yosys.log') };
  }
  const st = parseStat(r.out);
  const types = Object.entries(st.byType);
  const ffs = types.filter(([t]) => /DFF|FF_|SDFF|ALDFF|DFFSR/i.test(t) && !/LATCH/i.test(t)).reduce((s, [, n]) => s + n, 0);
  const latchCells = types.filter(([t]) => /LATCH/i.test(t)).reduce((s, [, n]) => s + n, 0);
  const latchSignals = latchOf(r.out);
  const depthM = /Longest topological path in \S+ \(length=(\d+)\)/.exec(r.out);
  // problems reported by `check` (undriven, multiple drivers, logic loops): the warnings printed right after the check pass
  const problems = [];
  const lines = r.out.split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/^Warning: /.test(l) && !/Replacing memory|Resizing cell port|wire.*is used but has no driver.*\$/.test(l)) problems.push(l.replace(/^Warning:\s*/, '').trim());
  });
  const found = [...r.out.matchAll(/Found and reported (\d+) problems/g)].map(m => +m[1]);
  const res = {
    state: 'done', top, seconds: Math.round((Date.now() - t0) / 100) / 10, where: w,
    cells: st.cells, wires: st.wires, wireBits: st.wireBits, byType: st.byType, flipflops: ffs, latches: latchCells, latchSignals,
    logicDepth: depthM ? +depthM[1] : null, checkProblems: found.length ? Math.max(...found) : 0, warnings: [...new Set(problems)].slice(0, 40),
    netlist: nl, json: js, log: path.join(outDir, 'yosys.log')
  };
  log(`[synth] ${res.cells} cells · ${ffs} flip-flops · ${latchCells} latches · logic depth ${res.logicDepth == null ? 'n/a' : res.logicDepth} · ${res.checkProblems} check problem(s) · ${res.seconds}s`);
  if (latchSignals.length) log(`[synth] latch inferred for: ${latchSignals.join(', ')}  (usually an incomplete if/case in combinational logic)`);
  return res;
}

/** logic-equivalence check: RTL (gold) vs netlist (gate). 'equivalent' | 'different' | 'unknown' */
function lec(root, cfg, netlist, log) {
  log = log || (() => {});
  const top = cfg.dut.top;
  const script = [
    reads(root, cfg), `hierarchy -top ${top}${chparams(cfg)}`, 'proc; flatten; opt_clean', `rename ${top} gold`, 'design -stash gold',
    `read_verilog -sv ${q(netlist)}`, `hierarchy -top ${top}`, 'proc; flatten; opt_clean', `rename ${top} gate`, 'design -stash gate',
    'design -copy-from gold -as gold gold', 'design -copy-from gate -as gate gate',
    'equiv_make gold gate equiv', 'hierarchy -top equiv', 'equiv_simple -seq 5', 'equiv_induct -seq 5', 'equiv_status'
  ].join('; ');
  const r = tools.run(root, 'yosys', ['-p', tools.yosysScript(root, script)], root, 600000);
  const m = /Found (\d+) \$equiv cells in equiv:\s*\n\s*Of those cells (\d+) are proven and (\d+) are unproven/.exec(r.out);
  const allProven = /Equivalence successfully proven!/.test(r.out);
  const res = { state: r.code === 0 && allProven ? 'equivalent' : m && +m[3] > 0 ? 'unproven' : r.code === 0 ? 'equivalent' : 'error',
    total: m ? +m[1] : null, proven: m ? +m[2] : null, unproven: m ? +m[3] : null, method: 'structural (equiv_*)',
    message: r.code !== 0 && !m ? ((r.out.split(/\r?\n/).find(l => /ERROR/.test(l)) || r.error || '').trim()) : '' };
  // structural matching loses track of renamed / re-encoded flip-flops after optimisation: prove the outputs equal
  // instead (miter of RTL and netlist, temporal induction from the all-zero reset state)
  if (res.state === 'unproven') {
    const s2 = [
      reads(root, cfg), `hierarchy -top ${top}${chparams(cfg)}`, 'proc; flatten; opt_clean', `rename ${top} gold`, 'design -stash gold',
      `read_verilog -sv ${q(netlist)}`, `hierarchy -top ${top}`, 'proc; flatten; opt_clean', `rename ${top} gate`, 'design -stash gate',
      'design -copy-from gold -as gold gold', 'design -copy-from gate -as gate gate', 'async2sync',
      'miter -equiv -flatten -make_assert -ignore_gold_x gold gate miter', 'hierarchy -top miter',
      'sat -verify -tempinduct -prove-asserts -set-init-zero -seq 1 -maxsteps 40 miter'
    ].join('; ');
    const r2 = tools.run(root, 'yosys', ['-p', tools.yosysScript(root, s2)], root, 900000);
    const k = /Trying induction with length (\d+)[\s\S]*?Induction step proven: SUCCESS/.exec(r2.out) ? [...r2.out.matchAll(/Trying induction with length (\d+)/g)].pop()[1] : null;
    if (r2.code === 0 && /SUCCESS/.test(r2.out)) Object.assign(res, { state: 'equivalent', method: `outputs proven equal (miter, induction length ${k})` });
    else if (/failed!|FAIL/.test(r2.out) && /counter ?example|model found/i.test(r2.out)) Object.assign(res, { state: 'different', method: 'miter found a counterexample' });
    else res.method += '; miter induction inconclusive within 40 steps';
  }
  log(`[lec] RTL vs netlist: ${res.state} — ${res.method}${res.total != null && res.method.startsWith('structural') ? ` (${res.proven}/${res.total} points)` : ''}${res.message ? ' — ' + res.message : ''}`);
  return res;
}

/** Verilator lint of the DUT: [{severity, code, file, line, col, message}] */
function lint(root, cfg, log) {
  log = log || (() => {});
  const files = cfg.dut.files.map(f => abs(root, f));
  const args = ['--lint-only', '-Wall', '-Wno-DECLFILENAME', '-Wno-UNUSEDSIGNAL', '--top-module', cfg.dut.top, ...(cfg.dut.incdirs || []).map(d => '-I' + abs(root, d)), ...Object.entries(cfg.dut.params || {}).map(([k, v]) => `-G${k}=${v}`), ...files];
  const r = tools.run(root, 'verilator', args, root, 300000);
  if (!r.where) return { state: 'unavailable', items: [], message: r.error };
  const items = [];
  const re = /^%(Warning|Error)(?:-([A-Z0-9_]+))?:\s*(.+?):(\d+):(?:(\d+):)?\s*(.*)$/gm;
  let m;
  while ((m = re.exec(r.out))) items.push({ severity: m[1] === 'Error' ? 'error' : 'warning', code: m[2] || '', file: path.basename(m[3]), line: +m[4], col: m[5] ? +m[5] : 1, message: m[6].trim() });
  const res = { state: items.some(i => i.severity === 'error') ? 'errors' : items.length ? 'warnings' : 'clean', items: items.slice(0, 80), errors: items.filter(i => i.severity === 'error').length, warnings: items.filter(i => i.severity === 'warning').length };
  log(`[lint] verilator -Wall: ${res.errors} error(s), ${res.warnings} warning(s)`);
  return res;
}

module.exports = { synthesize, lec, lint, parseStat };

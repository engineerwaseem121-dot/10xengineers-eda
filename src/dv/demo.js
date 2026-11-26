'use strict';
/*
 * Project set-up without prompts (same logic as "DV: Select DUT"), used by the demo project and `dvflow init`.
 *   proposeConfig(root, file, top?)  -> dvflow.json object (template guessed from the RTL)
 *   init(root, file, o)              -> writes dvflow.json + every testbench (mode 'all' by default)
 *   injectBug(root, cfg) / restore(root, cfg)   the demo's "plant a bug" step
 */
const fs = require('fs');
const path = require('path');
const hdl = require('../hdlparse');
const tbgen = require('./tbgen');
const runner = require('./runner');
const { guess } = require('./templates');

function proposeConfig(root, file, top, o) {
  o = o || {};
  const abs = path.resolve(root, file);
  const text = fs.readFileSync(abs, 'utf8');
  const mods = hdl.parseModules(text);
  if (!mods.length) throw new Error('no module found in ' + file);
  // the top module: the one asked for, else the one no other module instantiates, else the last
  const bodies = {};
  for (const m of text.matchAll(/\bmodule\s+(\w+)[\s\S]*?\bendmodule\b/g)) bodies[m[1]] = m[0];
  const instantiated = name => Object.entries(bodies).some(([n, b]) => n !== name && new RegExp('\\b' + name + '\\s+(#|\\w)').test(b.replace(/^module\s+\w+/, '')));
  const mod = (top && mods.find(m => m.name === top)) || mods.find(m => !instantiated(m.name)) || mods[mods.length - 1];
  const tpl = o.template || guess(mod);
  const c = hdl.classify(mod.ports);
  const seq = !!c.clk && tpl !== 'adder' && tpl !== 'latch';
  const cfg = {
    name: mod.name, template: tpl, mode: o.mode || 'all',
    dut: { top: mod.name, files: [path.relative(root, abs).replace(/\\/g, '/')], incdirs: [], params: {} },
    behavior: o.behavior || {},
    clock: { name: c.clk ? c.clk.name : 'clk', edge: 'posedge', period_ns: 10 },
    reset: seq && c.rst ? { name: c.rst.name, active_low: c.activeLow, sync: false, cycles: 2 } : { name: '' },
    ports: {},
    options: Object.assign({}, tbgen.DEFAULTS.options, { assertions: false }),
    tests: tpl === 'adder' ? ['smoke', 'boundary', 'exhaustive', 'random'] : (seq ? ['smoke', 'boundary', 'reset', 'random'] : ['smoke', 'boundary', 'random']),
    seeds: [1, 2, 3], configs: [{ name: 'default', params: {} }], simulator: o.simulator || 'icarus'
  };
  cfg.suites = { smoke: ['smoke'], full: cfg.tests };
  const d = tbgen.resolveDut(tbgen.withDefaults(cfg), root, {}, f => fs.readFileSync(f, 'utf8'));
  const m = tbgen.buildModel(tbgen.withDefaults(cfg), d.ports, d.paramValues);
  cfg.ports = m.roles || {};
  return { cfg, model: m };
}

function init(root, file, o) {
  o = o || {};
  const { cfg, model } = proposeConfig(root, file, o.top, o);
  fs.writeFileSync(path.join(root, 'dvflow.json'), JSON.stringify(cfg, null, 2) + '\n');
  const plan = runner.plannedFiles(root, runner.loadConfig(root), { mode: o.mode || 'all', engineSrc: o.engineSrc, runtime: o.runtime });
  runner.writeFiles(plan.files.filter(f => f.changed));
  return { cfg, model, files: plan.files.filter(f => f.changed).map(f => f.path) };
}

/** plant a realistic bug in the DUT (a copy of the original is kept as <file>.orig) */
function injectBug(root, cfg) {
  const f = path.resolve(root, cfg.dut.files[0]);
  const orig = f + '.orig';
  if (fs.existsSync(orig)) return { already: true, file: f };
  const text = fs.readFileSync(f, 'utf8');
  let bug = null, what = '';
  // the demo adder: drop the carry-in term of the carry-out (a classic slip)
  if (/assign\s+cout\s*=\s*\(a\s*&\s*b\)\s*\|\s*\(cin\s*&\s*\(a\s*\^\s*b\)\)\s*;/.test(text)) {
    bug = text.replace(/assign\s+cout\s*=\s*\(a\s*&\s*b\)\s*\|\s*\(cin\s*&\s*\(a\s*\^\s*b\)\)\s*;/, 'assign cout = (a & b);   // BUG (demo): carry-in no longer propagates');
    what = 'cout = (a & b)   — the carry-in no longer propagates';
  } else {
    // any other design: the first operator mutation that is not formally equivalent
    const mu = require('./mutate').mutantsOf(text).find(x => /& → \||\+ → -|== → !=/.test(x.rule));
    if (!mu) throw new Error('no place to plant a bug was found in ' + path.basename(f));
    bug = mu.text; what = `${mu.rule} on line ${mu.line}: ${mu.after}`;
  }
  fs.writeFileSync(orig, text);
  fs.writeFileSync(f, bug);
  return { file: f, what };
}
function restore(root, cfg) {
  const f = path.resolve(root, cfg.dut.files[0]);
  if (!fs.existsSync(f + '.orig')) return false;
  fs.writeFileSync(f, fs.readFileSync(f + '.orig'));
  fs.unlinkSync(f + '.orig');
  return true;
}
const bugActive = (root, cfg) => fs.existsSync(path.resolve(root, cfg.dut.files[0]) + '.orig');

module.exports = { proposeConfig, init, injectBug, restore, bugActive };

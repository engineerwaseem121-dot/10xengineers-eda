'use strict';
/*
 * Project layout: one place that knows where generated files live.
 *
 *   <project>/
 *     dvflow.json            DUT + behaviour spec
 *     Makefile, dvflow.sh, dvflow.cmd
 *     design/                RTL ("DV: Select DUT" offers to move a loose RTL file here)
 *     testplan/              testplan.yaml (edited by you) + testplan.xlsx (results, rewritten by every run)
 *     tb/                    simple self-checking SV testbench
 *     uvm/
 *       <top>_pkg.sv         package: includes everything below
 *       files.f              source list (RTL + testbench), compiled from uvm/
 *       tb/                  tb_top.sv, <top>_if.sv, <top>_assertions.sv
 *       agent/               cfg, seq_item, sequencer, driver, monitor, agent
 *       sequences/           <top>_sequences.sv
 *       env/                 env, scoreboard, coverage
 *       tests/               <top>_tests.sv
 *       scripts/             run.do, Makefile, run.sh, run.bat (Questa)
 *     cocotb/                Python testbench
 *     runs/                  one folder per run
 *
 * Projects made by older versions (testplan.yaml in the project root, a flat uvm/ folder) keep working:
 * every lookup falls back to the old place, and regenerating moves the files to the new one.
 */
const fs = require('fs');
const path = require('path');

const PLAN_DIR = 'testplan';
const UVM_SUBDIRS = ['tb', 'agent', 'sequences', 'env', 'tests', 'scripts'];

/** generated UVM file -> sub-folder of uvm/ ('' = uvm/ itself) */
function uvmSub(file, top) {
  const b = path.basename(file);
  if (b === 'tb_top.sv' || b === top + '_if.sv' || b === top + '_assertions.sv') return 'tb';
  if (['_cfg.sv', '_seq_item.sv', '_sequencer.sv', '_driver.sv', '_monitor.sv', '_agent.sv'].some(s => b === top + s)) return 'agent';
  if (b === top + '_sequences.sv') return 'sequences';
  if (['_env.sv', '_scoreboard.sv', '_coverage.sv'].some(s => b === top + s)) return 'env';
  if (b === top + '_tests.sv') return 'tests';
  if (['run.do', 'Makefile', 'run.sh', 'run.bat'].includes(b)) return 'scripts';
  return '';
}

/* ---------------- test plan */
const planYamlNew = root => path.join(root, PLAN_DIR, 'testplan.yaml');
const planYamlOld = root => path.join(root, 'testplan.yaml');
/** where testplan.yaml is: testplan/, unless only an old-layout plan (project root) exists */
function planYaml(root) { return !fs.existsSync(planYamlNew(root)) && fs.existsSync(planYamlOld(root)) ? planYamlOld(root) : planYamlNew(root); }
function planXlsx(root) { return path.join(path.dirname(planYaml(root)), 'testplan.xlsx'); }
/** project-relative path of testplan.yaml, '/' separated */
function planYamlRel(root) { return path.relative(root, planYaml(root)).split(path.sep).join('/'); }
/** remove an old-layout plan once the new one exists (its content was merged into the new one) */
function retireOldPlan(root) {
  if (!fs.existsSync(planYamlNew(root))) return false;
  let moved = false;
  for (const f of ['testplan.yaml', 'testplan.xlsx']) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); moved = true; } catch (e) { /* open in Excel */ } }
  }
  return moved;
}

/* ---------------- UVM */
/** uvm/<sub>/<file> in the new layout, else uvm/<file> (old flat layout) */
function uvmPath(root, top, file) {
  const nw = path.join(root, 'uvm', uvmSub(file, top), file), old = path.join(root, 'uvm', file);
  return fs.existsSync(nw) || !fs.existsSync(old) ? nw : old;
}
function hasUvm(root) { return fs.existsSync(path.join(root, 'uvm', 'files.f')); }
/**
 * After generating the new layout: flat files left by an older version would shadow the new ones (the package
 * includes them by name), so they move to uvm/_old_flat_layout/ (kept, in case you had edited them).
 */
function retireFlatUvm(root, top) {
  const dir = path.join(root, 'uvm');
  if (!fs.existsSync(path.join(dir, 'tb', 'tb_top.sv'))) return [];
  const moved = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (!uvmSub(f, top) || !fs.statSync(p).isFile()) continue;
    const bk = path.join(dir, '_old_flat_layout');
    fs.mkdirSync(bk, { recursive: true });
    fs.renameSync(p, path.join(bk, f));
    moved.push(f);
  }
  return moved;
}

module.exports = { PLAN_DIR, UVM_SUBDIRS, uvmSub, planYaml, planXlsx, planYamlRel, retireOldPlan, uvmPath, hasUvm, retireFlatUvm };

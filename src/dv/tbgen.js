'use strict';
/* Lightweight self-checking SystemVerilog testbench + SVA + file list + Makefile + wrappers. */
const path = require('path');
const hdl = require('../hdlparse');
const { TEMPLATES } = require('./templates');

const DEFAULTS = {
  clock: { name: 'clk', edge: 'posedge', period_ns: 10 },
  reset: { name: '', active_low: true, sync: false, cycles: 2 },
  options: { waves: false, code_coverage: false, functional_coverage: true, assertions: false, random_iterations: 200, timeout_ns: 5000000, max_reported_mismatches: 20 },
  tests: ['smoke', 'boundary', 'exhaustive', 'random', 'reset'],
  suites: { smoke: ['smoke'], full: ['smoke', 'boundary', 'exhaustive', 'random', 'reset'] },
  seeds: [1, 2, 3],
  configs: [{ name: 'default', params: {} }],
  simulator: 'icarus'
};

function withDefaults(cfg) {
  const c = JSON.parse(JSON.stringify(cfg));
  for (const k of Object.keys(DEFAULTS)) {
    if (c[k] == null) c[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
    else if (typeof DEFAULTS[k] === 'object' && !Array.isArray(DEFAULTS[k])) c[k] = Object.assign({}, DEFAULTS[k], c[k]);
  }
  c.behavior = c.behavior || {};
  c.dut = c.dut || {};
  c.dut.params = c.dut.params || {};
  c.dut.incdirs = c.dut.incdirs || [];
  return c;
}

/** Parse the DUT and resolve port widths for a given parameter override set. */
function resolveDut(cfg, root, params, readFile) {
  const files = cfg.dut.files.map(f => path.resolve(root, f));
  let mod = null, file = null;
  for (const f of files) {
    const m = hdl.parseModules(readFile(f)).find(x => x.name === cfg.dut.top);
    if (m) { mod = m; file = f; break; }
  }
  if (!mod) throw new Error(`Top module '${cfg.dut.top}' not found in ${cfg.dut.files.join(', ')}`);
  const pv = Object.assign({}, mod.paramValues);
  Object.entries(Object.assign({}, cfg.dut.params, params || {})).forEach(([k, v]) => { pv[k] = Number(v); });
  // re-evaluate dependent parameters (e.g. localparam AW = $clog2(DEPTH))
  for (const p of mod.params) { const v = hdl.evalExpr(p.expr || p.value, pv); if (v != null && !(p.name in (Object.assign({}, cfg.dut.params, params || {})))) pv[p.name] = v; }
  const ports = mod.ports.map(p => {
    if (!p.range) return Object.assign({}, p, { width: p.width || 1 });
    const m = /\[\s*([^:\]]+)\s*:\s*([^\]]+)\]/.exec(p.range);
    const a = m && hdl.evalExpr(m[1], pv), b = m && hdl.evalExpr(m[2], pv);
    return Object.assign({}, p, { width: a != null && b != null ? Math.abs(a - b) + 1 : (p.width || 1) });
  });
  return { mod, file, ports, paramValues: pv };
}

function buildModel(cfg, ports, paramValues) {
  // behaviour values such as "$N" follow the DUT parameter of the configuration being built
  if (paramValues) { cfg = Object.assign({}, cfg, { behavior: JSON.parse(JSON.stringify(cfg.behavior || {}), (k, v) => (typeof v === 'string' && /^\$\w+$/.test(v) && paramValues[v.slice(1)] != null ? paramValues[v.slice(1)] : v)) }); }
  const t = TEMPLATES[cfg.template];
  if (!t) throw new Error(`Unknown template '${cfg.template}'. Use one of: ${Object.keys(TEMPLATES).join(', ')}`);
  const model = t.build(cfg, ports);
  model.checks = model.checks || [];
  const missing = model.inputs.filter(i => !i.name).length + model.checks.filter(c => !c.name).length;
  if (missing) throw new Error(`Could not map all DUT ports for template '${cfg.template}'. Set "ports" in dvflow.json (detected: ${JSON.stringify(model.roles)}).`);
  if (model.seq && !cfg.reset.name && !model.latch) throw new Error('Sequential DUT without a reset: set reset.name in dvflow.json (the testbench needs a known start state).');
  model.checkers = model.checkCode
    ? [{ id: 'CHK-SB-TXN', kind: 'scoreboard', desc: 'in-order transaction scoreboard with end-of-test missing-transaction check' }]
    : model.checks.map(c => ({ id: 'CHK-CMP-' + c.name.toUpperCase(), kind: 'compare', desc: `${c.name} === ${c.exp}`, signal: c.name }));
  return model;
}

const q = s => String(s).replace(/"/g, '\\"');

function genTb(cfg, model, dut, paramOverrides) {
  const top = cfg.dut.top;
  const sv = cfg.reset.name;
  const rstOn = cfg.reset.active_low ? "1'b0" : "1'b1";
  const rstOff = cfg.reset.active_low ? "1'b1" : "1'b0";
  const act = cfg.clock.edge === 'negedge' ? 'negedge' : 'posedge';
  const opp = act === 'posedge' ? 'negedge' : 'posedge';
  const half = (cfg.clock.period_ns || 10) / 2;
  const hasClkPort = dut.ports.some(p => p.name === cfg.clock.name);
  const hasRstPort = sv && dut.ports.some(p => p.name === sv);
  const W = i => `[${Math.max(1, i.width) - 1}:0]`;
  const inSet = new Set(model.inputs.map(i => i.name));
  const params = Object.assign({}, cfg.dut.params, paramOverrides || {});
  const sc = model.scenarios;
  const bins = model.bins;
  const inFmt = model.inputs.map(i => `${i.name}=%0h`).join(' ');
  const inArgs = model.inputs.map(i => `in_${i.name}`).join(', ');
  const conns = dut.ports.map(p => {
    if (p.name === cfg.clock.name) return `.${p.name}(clk)`;
    if (p.name === sv) return `.${p.name}(rst)`;
    if (inSet.has(p.name)) return `.${p.name}(in_${p.name})`;
    if (p.dir === 'input') return `.${p.name}('0)   /* not driven by the template */`;
    return `.${p.name}(${p.name})`;
  });
  const body = s => s.body.replace(/ITERATIONS/g, 'iterations');
  const checkAll = model.checkCode || model.checks.map(c => `    ${c.guard ? `if (${c.guard}) begin` : 'begin'}
      checks++; sc_checks[cur_sc]++;
      if (${c.name} !== (${c.exp})) fail_check("${c.name}", ${c.exp}, ${c.name}, "value mismatch");
    end`).join('\n');
  return `// =============================================================================
// Self-checking testbench for ${top} — template '${cfg.template}'
// Generated by 10xEngineers EDA DV flow from dvflow.json. Regenerate instead of hand-editing;
// the expected behaviour lives in dvflow.json ("behavior") and in the reference model below.
// Scenario IDs match testplan.yaml and the UVM environment.
// Timing: inputs are driven on the ${opp} edge, outputs are sampled 1ns after the ${act} edge (race-free).
// Result line: DVFLOW_RESULT PASS|FAIL errors=<n> checks=<n>
// =============================================================================
\`timescale 1ns/1ps
module tb_${top};
  parameter int ITERATIONS_DEFAULT = ${cfg.options.random_iterations};
  parameter longint TIMEOUT_NS = ${cfg.options.timeout_ns};
  parameter int MAX_REPORT = ${cfg.options.max_reported_mismatches};
  parameter int RESET_CYCLES = ${Math.max(1, cfg.reset.cycles || 2)};

  // ---------------------------------------------------------------- clock / reset
  logic clk = 1'b0;
  always #(${half}) clk = ~clk;
  logic rst = ${sv ? rstOff : "1'b0"};

  // ---------------------------------------------------------------- DUT
${model.inputs.map(i => `  logic ${W(i)} in_${i.name} = '0;`).join('\n')}
${dut.ports.filter(p => p.dir !== 'input').map(p => `  wire  [${Math.max(1, p.width) - 1}:0] ${p.name};`).join('\n')}

  ${top}${Object.keys(params).length ? ' #(' + Object.entries(params).map(([k, v]) => `.${k}(${v})`).join(', ') + ')' : ''} dut (
    ${conns.join(',\n    ')}
  );
${hasClkPort ? '' : '  // (combinational DUT: clk only defines the drive/sample grid)\n'}
  // ---------------------------------------------------------------- run control
  integer seed, seed_orig, iterations, errors = 0, checks = 0, cur_sc = 0;
  reg [8*64-1:0] test_name, only_sc;
  integer sc_checks [0:${Math.max(1, sc.length) - 1}];
  integer sc_fails  [0:${Math.max(1, sc.length) - 1}];
  integer sc_ran    [0:${Math.max(1, sc.length) - 1}];
  integer bin_hits  [0:${Math.max(1, bins.length) - 1}];

  function automatic [8*32-1:0] sc_name(input integer i);
    case (i)
${sc.map((s, k) => `      ${k}: sc_name = "${s.id}";`).join('\n')}
      default: sc_name = "SC-NONE";
    endcase
  endfunction

  function automatic [8*40-1:0] bin_name(input integer i);
    case (i)
${bins.map((b, k) => `      ${k}: bin_name = "${b.id}";\n`).join('')}      default: bin_name = "BIN-NONE";
    endcase
  endfunction

  function automatic integer rnd();
    rnd = $random(seed);
  endfunction

  // ---------------------------------------------------------------- reference model (from the approved behaviour spec)
${model.decl}

  task automatic model_reset();
${model.reset || '    ;'}
  endtask

  task automatic model_step();
${model.step || '    ;'}
  endtask

  // ---------------------------------------------------------------- checking
  task automatic fail_check(input [8*32-1:0] sig, input [127:0] exp_v, input [127:0] act_v, input [8*48-1:0] why);
    errors++;
    sc_fails[cur_sc]++;
    if (errors <= MAX_REPORT)
      $display("DVFLOW_MISMATCH t=%0t test=%0s seed=%0d scenario=%0s signal=%0s expected=%0h actual=%0h reason=%0s inputs: ${inFmt}",
               $time, test_name, seed_orig, sc_name(cur_sc), sig, exp_v, act_v, why${inArgs ? ', ' + inArgs : ''});
  endtask

  task automatic check_all();
${checkAll}
  endtask

  task automatic sample_bins();
${bins.map((b, k) => `    if (${b.cond}) bin_hits[${k}]++;`).join('\n') || '    ;'}
${model.postBins || ''}
  endtask

  // ---------------------------------------------------------------- stimulus helpers
  task automatic drive(${model.inputs.map(i => `input logic ${W(i)} v_${i.name}`).join(', ')});
${model.inputs.map(i => `    in_${i.name} = v_${i.name};`).join('\n')}
  endtask

  bit at_drive_phase = 0;   // set when do_reset() released reset on the drive edge
  task automatic apply(${model.inputs.map(i => `input logic ${W(i)} v_${i.name}`).join(', ')});
    if (!at_drive_phase) @(${opp} clk);
    at_drive_phase = 0;
${model.inputs.map(i => `    in_${i.name} = v_${i.name};`).join('\n')}
    @(${act} clk);
    #1;
    model_step();
    check_all();
    sample_bins();
  endtask

  task automatic idle(input integer n);
    repeat (n) apply(${model.inputs.map(i => `in_${i.name}`).join(', ')});
  endtask

  task automatic do_reset();
${model.preReset || ''}
${sv ? `    @(${opp} clk);
    rst = ${rstOn};
    repeat (RESET_CYCLES) @(${act} clk);
    #1;
    model_reset();
    check_all();
    sample_bins();
    @(${opp} clk);
    rst = ${rstOff};
    at_drive_phase = 1;` : '    model_reset();'}
  endtask

  function automatic bit run_sc(input integer idx, input [8*16-1:0] t);
    run_sc = ((test_name == "all") || (test_name == t)) && ((only_sc == 0) || (only_sc == sc_name(idx)));
  endfunction

  task automatic finish_test();
    for (int i = 0; i < ${sc.length}; i++)
      $display("DVFLOW_SCENARIO %0s ran=%0d checks=%0d fails=%0d", sc_name(i), sc_ran[i], sc_checks[i], sc_fails[i]);
    for (int i = 0; i < ${bins.length}; i++)
      $display("DVFLOW_BIN %0s %0d", bin_name(i), bin_hits[i]);
    if (checks == 0) $display("DVFLOW_RESULT FAIL errors=%0d checks=0 reason=no_checks_executed", errors);
    else $display("DVFLOW_RESULT %0s errors=%0d checks=%0d", (errors == 0) ? "PASS" : "FAIL", errors, checks);
    $finish;
  endtask

  // ---------------------------------------------------------------- watchdog
  initial begin
    #(TIMEOUT_NS);
    $display("DVFLOW_TIMEOUT t=%0t test=%0s seed=%0d scenario=%0s", $time, test_name, seed_orig, sc_name(cur_sc));
    errors++;
    for (int i = 0; i < ${sc.length}; i++)
      $display("DVFLOW_SCENARIO %0s ran=%0d checks=%0d fails=%0d", sc_name(i), sc_ran[i], sc_checks[i], sc_fails[i]);
    $display("DVFLOW_RESULT FAIL errors=%0d checks=%0d reason=timeout", errors, checks);
    $finish;
  end

  // ---------------------------------------------------------------- main
  initial begin
    if (!$value$plusargs("SEED=%d", seed)) seed = 1;
    seed_orig = seed;
    if (!$value$plusargs("TEST=%s", test_name)) test_name = "all";
    if (!$value$plusargs("SCENARIO=%s", only_sc)) only_sc = 0;
    if (!$value$plusargs("ITERATIONS=%d", iterations)) iterations = ITERATIONS_DEFAULT;
    if ($test$plusargs("WAVES")) begin
      $dumpfile("waves.vcd");
      $dumpvars(0, tb_${top});
    end
    for (int i = 0; i < ${Math.max(1, sc.length)}; i++) begin sc_checks[i] = 0; sc_fails[i] = 0; sc_ran[i] = 0; end
    for (int i = 0; i < ${Math.max(1, bins.length)}; i++) bin_hits[i] = 0;
    $display("DVFLOW_START dut=${top} template=${cfg.template} test=%0s seed=%0d iterations=%0d", test_name, seed_orig, iterations);
    model_reset();
${sv ? '    do_reset();' : ''}
${sc.map((s, k) => `    if (run_sc(${k}, "${s.test}")) begin   // ${s.id}: ${s.title}
      cur_sc = ${k}; sc_ran[${k}] = 1;
      ${body(s)}
    end`).join('\n')}
${model.endCode || ''}
    finish_test();
  end
${cfg.options.assertions ? `
\`ifdef DVFLOW_SVA
  sva_${top} u_sva (.clk(clk)${sv ? ', .' + sv + '(rst)' : ''}${dut.ports.filter(p => p.name !== cfg.clock.name && p.name !== sv).map(p => `, .${p.name}(${inSet.has(p.name) ? 'in_' + p.name : p.name})`).join('')});
\`endif` : ''}
endmodule
`;
}

function genSva(cfg, model, dut) {
  const sv = cfg.reset.name;
  const ports = dut.ports.filter(p => p.name !== cfg.clock.name && p.name !== sv);
  return `// SVA checker for ${cfg.dut.top} — requires a simulator with concurrent SVA (Questa, VCS).
// Compiled only with +define+DVFLOW_SVA; Icarus Verilog reports assertions as unsupported.
module sva_${cfg.dut.top} (input logic clk${sv ? `, input logic ${sv}` : ''}${ports.map(p => `, input logic [${Math.max(1, p.width) - 1}:0] ${p.name}`).join('')});
${model.sva || '  // no template assertions'}
endmodule
`;
}

function fileList(cfg, root, tbRel) {
  return [
    '// source list generated by 10xEngineers EDA DV flow',
    ...cfg.dut.incdirs.map(d => '+incdir+' + d.replace(/\\/g, '/')),
    ...cfg.dut.files.map(f => f.replace(/\\/g, '/')),
    ...(cfg.options.assertions ? [tbRel.replace(/tb_[^/]+\.sv$/, `sva_${cfg.dut.top}.sv`)] : []),
    tbRel
  ].join('\n') + '\n';
}

function makefile(cfg) {
  return `# Generated by 10xEngineers EDA DV flow. Same engine and the same simulator settings as the extension.
# Simulator selection:  SIM=questa | verilator | icarus | ghdl | vcs   (default from dvflow.json: ${cfg.simulator})
# Tool location:        QUESTA_BIN / VERILATOR_BIN / GHDL_BIN / ICARUS_BIN / VCS_BIN = install dir or bin dir
#                       (else ~/.dvflow/simulators.json, else PATH). License settings never go in this file.
# Examples:
#   make doctor  SIM=questa                      installation + license smoke (+UVM/coverage when enabled)
#   make build   SIM=questa
#   make run     SIM=questa TEST=${cfg.dut.top}_smoke SEED=42
#   make run     TEST=random SEED=1 COUNT=100       100 runs: seed 1, then 99 random seeds
#   make bugdemo                                 runs the injected-bug RTL (dvflow.json bug_injection); passes when the bug is caught
#   make regress SIM=questa SUITE=full
#   make retry                                   re-run what failed last time (same simulator, test, seed)
#   make rerun   RUN=<id> TEST=<t> SEED=<s> WAVES=1
ifeq ($(OS),Windows_NT)
DV     ?= $(CURDIR)/dvflow.cmd
else
DV     ?= ./dvflow.sh
endif
SIM    ?= ${cfg.simulator}
TOP    ?= ${cfg.dut.top}
TEST   ?= all
SEED   ?= 1
SEEDS  ?=
SUITE  ?= full
CONFIG ?= default
WAVES  ?= 0
COV    ?= 0
RUN    ?= latest

TOOLS  = $(if $(QUESTA_BIN),--questa-bin "$(QUESTA_BIN)") $(if $(VERILATOR_BIN),--verilator-bin "$(VERILATOR_BIN)") $(if $(GHDL_BIN),--ghdl-bin "$(GHDL_BIN)") $(if $(ICARUS_BIN),--icarus-bin "$(ICARUS_BIN)") $(if $(VCS_BIN),--vcs-bin "$(VCS_BIN)")
ARGS   = --sim $(SIM) --waves $(WAVES) --cov $(COV) $(TOOLS)
CFGARG = $(if $(filter default,$(CONFIG)),,--config $(CONFIG))

.PHONY: doctor build run regress coverage report retry rerun clean capabilities simconfig bugdemo
doctor:
\t$(DV) doctor --sim $(SIM) $(TOOLS)
build:
\t$(DV) build $(ARGS) $(CFGARG)
run:
\t$(DV) run $(ARGS) $(CFGARG) --test $(TEST) --seed $(SEED) $(if $(COUNT),--count $(COUNT),)
regress:
\t$(DV) regress $(ARGS) --suite $(SUITE) $(if $(SEEDS),--seeds $(SEEDS),) $(if $(COUNT),--count $(COUNT),)
bugdemo:
\t$(DV) regress $(TOOLS) --sim $(SIM) --bug 1
coverage:
\t$(DV) regress $(TOOLS) --sim $(SIM) --suite $(SUITE) --cov 1
retry:
\t$(DV) retry --run $(RUN) $(TOOLS) $(if $(filter command line,$(origin SIM)),--sim $(SIM),)
report:
\t$(DV) report --run $(RUN)
rerun:
\t$(DV) rerun --run $(RUN) --test $(TEST) --seed $(SEED) --config $(CONFIG) --waves $(WAVES) $(TOOLS)
capabilities:
\t$(DV) capabilities $(TOOLS)
simconfig:
\t$(DV) simconfig
clean:
\t$(DV) clean
`;
}
function wrappers(runtime) {
  // runtime: absolute path of an Electron/VS Code executable that can act as node (fallback when node is absent)
  const cmd = `@echo off
rem 10xEngineers EDA DV flow CLI wrapper (uses node, or the editor's runtime when node is not installed)
setlocal
set "ENGINE=%~dp0.dvflow\\engine\\cli.js"
where node >nul 2>nul
if %ERRORLEVEL%==0 (
  node "%ENGINE%" %*
) else (
  set ELECTRON_RUN_AS_NODE=1
  "${runtime || 'node'}" "%ENGINE%" %*
)
exit /b %ERRORLEVEL%
`;
  const sh = `#!/usr/bin/env sh
# 10xEngineers EDA DV flow CLI wrapper
DIR="$(cd "$(dirname "$0")" && pwd)"
if command -v node >/dev/null 2>&1; then exec node "$DIR/.dvflow/engine/cli.js" "$@"; fi
ELECTRON_RUN_AS_NODE=1 exec "\${DVFLOW_RUNTIME:-code}" "$DIR/.dvflow/engine/cli.js" "$@"
`;
  return { cmd, sh };
}

/* ---------------------------------------------------------------- UVM: same scenario IDs as directed sequences */
function uvmCustom(cfg, model) {
  const n = cfg.dut.top;
  const inputs = model.inputs;
  const seqs = model.scenarios.map(s => `// ---------------------------------------------------------------- ${s.id}: ${s.title}
class ${n}_${s.id.replace(/-/g, '_').toLowerCase()}_seq extends ${n}_scenario_base_seq;
  §uvm_object_utils(${n}_${s.id.replace(/-/g, '_').toLowerCase()}_seq)
  function new(string name = "${n}_${s.id.replace(/-/g, '_').toLowerCase()}_seq");
    super.new(name);
    scenario_id = "${s.id}";
  endfunction
  virtual task body();
    §uvm_info("DVFLOW_SCENARIO", "${s.id} start", UVM_LOW)
    ${s.body.replace(/ITERATIONS/g, 'iterations')}
  endtask
endclass
`).join('\n');
  const base = `// ---------------------------------------------------------------- scenario base: apply() mirrors the lightweight testbench
class ${n}_scenario_base_seq extends ${n}_base_seq;
  §uvm_object_utils(${n}_scenario_base_seq)
  string scenario_id;
  int unsigned iterations = ${cfg.options.random_iterations};
  function new(string name = "${n}_scenario_base_seq");
    super.new(name);
  endfunction
  function int rnd();
    return $urandom;
  endfunction
  task do_reset();   // reset is owned by tb_top in the UVM flow
  endtask
  task idle(int n);
    repeat (n) apply(${inputs.map(() => "'0").join(', ')});
  endtask
  task drive(${inputs.map(i => `logic [${Math.max(1, i.width) - 1}:0] v_${i.name}`).join(', ')});
  endtask
  task apply(${inputs.map(i => `logic [${Math.max(1, i.width) - 1}:0] v_${i.name}`).join(', ')});
    req = ${n}_seq_item::type_id::create("req");
    start_item(req);
${inputs.map(i => `    req.${i.name} = v_${i.name};`).join('\n')}
    req.delay = 0;
    finish_item(req);
  endtask
endclass
`;
  const tests = [...new Set(model.scenarios.map(s => s.test))];
  const closure = model.scenarios.map(s => { const c = `${n}_${s.id.replace(/-/g, '_').toLowerCase()}_seq`; return `    begin ${c} s = ${c}::type_id::create("${s.id}"); s.start(env.agt.sqr); end`; }).join('\n');
  const testClasses = tests.map(t => `
class ${n}_dv_${t}_test extends ${n}_base_test;   // runs the scenarios of lightweight test '${t}'
  §uvm_component_utils(${n}_dv_${t}_test)
  function new(string name, uvm_component parent);
    super.new(name, parent);
  endfunction
  virtual task run_body();
${model.scenarios.filter(s => s.test === t).map(s => { const c = `${n}_${s.id.replace(/-/g, '_').toLowerCase()}_seq`; return `    begin ${c} s = ${c}::type_id::create("${s.id}"); s.start(env.agt.sqr); end`; }).join('\n')}
  endtask
endclass`).join('\n');
  // reference model inside the scoreboard: same model code as the lightweight TB
  const comb = !model.seq;
  const predict = model.checkCode ? '' : `      // inputs of this sample
${inputs.map(i => `      in_${i.name} = obs.${i.name};`).join('\n')}
${comb ? '      model_step();\n' : ''}${model.checks.map(c => `      exp.${c.name} = ${c.exp};`).join('\n')}
${comb ? '' : '      model_step();   // registered DUT: outputs of this sample reflect the state before this edge\n'}`;
  const modelDecls = `${inputs.map(i => `  logic [${Math.max(1, i.width) - 1}:0] in_${i.name};`).join('\n')}
${model.decl}
  function void model_reset();
${model.reset || '    ;'}
  endfunction
  function void model_step();
${model.step || '    ;'}
  endfunction
  function void start_of_simulation_phase(uvm_phase phase);
    model_reset();
  endfunction
`;
  return { seqs: base + '\n' + seqs, tests: testClasses, closure, predict: model.checkCode ? null : predict, modelDecls: model.checkCode ? '' : modelDecls };
}

module.exports = { withDefaults, resolveDut, buildModel, genTb, genSva, fileList, makefile, wrappers, uvmCustom, DEFAULTS };

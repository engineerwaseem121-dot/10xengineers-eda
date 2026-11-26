'use strict';
/*
 * UVM environment generator.
 * opts = {
 *   name,                      agent / env prefix (SV identifier)
 *   dut: {name, params:[{name,value}], ports:[...]} | null   (from hdlparse.parseModules)
 *   active: true|false,        default agent mode (overridable at runtime via config)
 *   features: {coverage, scoreboard, assertions, questa},
 *   clkPeriod: 10,             ns
 *   rtlFiles: ['../rtl/dut.sv']   paths relative to the generated folder (source list)
 * }
 * Returns { files: {relPath: content}, warnings: [] }
 * NOTE: '§' in templates is replaced by a backtick (SV macro prefix).
 */
const { classify } = require('./hdlparse');

const BT = s => s.replace(/§/g, '`');

function decl(p) {
  const w = p.width;
  if (w && w > 1) return `logic ${p.signed ? 'signed ' : ''}[${w - 1}:0]`;
  if (w == null && p.range) return `logic ${p.signed ? 'signed ' : ''}${p.range}`;
  return 'logic';
}
const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length));

function binsFor(p) {
  const w = p.width;
  if (!w || w === 1 || w <= 3) return '';
  if (w > 32) return ` {\n      bins zero    = {0};\n      bins nonzero = {[1:$]};\n    }`;
  const max = Math.pow(2, w) - 1;
  const q = Math.pow(2, w) / 4;
  return ` {\n      bins zero = {0};\n      bins low  = {[1:${q - 1}]};\n      bins mid  = {[${q}:${3 * q - 1}]};\n      bins high = {[${3 * q}:${max - 1}]};\n      bins max  = {${max}};\n    }`;
}

function generate(opts) {
  const n = opts.name;
  const N = n.toUpperCase();
  const f = opts.features || {};
  const warnings = [];
  const files = {};
  const period = opts.clkPeriod || 10;
  const C = opts.custom || {};

  let clk = 'clk', rst = 'rst_n', activeLow = true, inputs, outputs, dutName = null, params = [];
  if (opts.dut) {
    const c = classify(opts.dut.ports);
    dutName = opts.dut.name;
    params = opts.dut.params || [];
    if (c.clk) clk = c.clk.name; else warnings.push(`No clock port detected on ${dutName}; tb_top generates '${clk}' but it is not connected to the DUT.`);
    if (c.rst) { rst = c.rst.name; activeLow = c.activeLow; } else warnings.push(`No reset port detected on ${dutName}; using a testbench-only reset '${rst}'.`);
    if (c.unsupported.length) warnings.push(`Interface ports are not auto-connected: ${c.unsupported.map(p => p.name).join(', ')}.`);
    inputs = c.inputs; outputs = c.outputs;
    [...inputs, ...outputs].forEach(p => { if (p.width == null) warnings.push(`Could not evaluate the width of '${p.name}' (${p.range}); declared with the same range text — check parameters.`); });
    if (!inputs.length) warnings.push('DUT has no data inputs; the driver will only control reset.');
    if (!opts.dut.ports.some(p => p.name === clk)) clk = 'clk';
  } else {
    inputs = [{ name: 'valid', dir: 'input', width: 1, range: '' }, { name: 'data', dir: 'input', width: 32, range: '[31:0]' }];
    outputs = [{ name: 'ready', dir: 'output', width: 1, range: '' }];
  }
  const rstActive = activeLow ? '1\'b0' : '1\'b1';
  const rstIdle = activeLow ? '1\'b1' : '1\'b0';
  const inReset = activeLow ? `!vif.${rst}` : `vif.${rst}`;
  // the monitor reads reset through mon_cb (sampled before the edge, like the outputs): reading vif.reset live races with
  // the reset release on that same edge, and the reference model would step once more than the DUT
  const monReset = activeLow ? `!vif.mon_cb.${rst}` : `vif.mon_cb.${rst}`;
  const all = [...inputs, ...outputs];
  const hasHandshake = inputs.some(p => /valid/i.test(p.name)) && outputs.some(p => /ready/i.test(p.name));
  const validSig = hasHandshake ? inputs.find(p => /valid/i.test(p.name)).name : null;
  const readySig = hasHandshake ? outputs.find(p => /ready/i.test(p.name)).name : null;

  /* ---------------- interface */
  files[`${n}_if.sv`] = BT(`// ${n} interface${dutName ? ' — generated from DUT ' + dutName : ''}
interface ${n}_if (input logic ${clk}, input logic ${rst});
${all.map(p => `  ${pad(decl(p), 22)}${p.name};${p.dir !== 'input' ? '   // DUT output' : ''}`).join('\n')}

  // driver clocking block: drives DUT inputs, samples DUT outputs
  clocking drv_cb @(posedge ${clk});
    default input #1step output #1;
${inputs.length ? `    output ${inputs.map(p => p.name).join(', ')};` : ''}
${outputs.length ? `    input  ${outputs.map(p => p.name).join(', ')};` : ''}
  endclocking

  // monitor clocking block: samples everything
  clocking mon_cb @(posedge ${clk});
    default input #1step;
    input ${[...all.map(p => p.name), rst].join(', ')};
  endclocking

§ifndef VERILATOR
  // modports with clocking blocks (Verilator does not support them; the TB uses the clocking blocks directly)
  modport DRV (clocking drv_cb, input ${clk}, ${rst});
  modport MON (clocking mon_cb, input ${clk}, ${rst});
§endif
endinterface
`);

  /* ---------------- config */
  files[`${n}_cfg.sv`] = BT(`// Agent configuration object: switch active/passive, coverage and checks at run time
class ${n}_cfg extends uvm_object;
  uvm_active_passive_enum is_active    = ${opts.active === false ? 'UVM_PASSIVE' : 'UVM_ACTIVE'};
  bit                     has_coverage = ${f.coverage ? 1 : 0};
  bit                     has_checks   = 1;
  int unsigned            reset_cycles = 5;
  virtual ${n}_if         vif;

  §uvm_object_utils_begin(${n}_cfg)
    §uvm_field_enum(uvm_active_passive_enum, is_active, UVM_DEFAULT)
    §uvm_field_int(has_coverage, UVM_DEFAULT)
    §uvm_field_int(has_checks,   UVM_DEFAULT)
    §uvm_field_int(reset_cycles, UVM_DEFAULT)
  §uvm_object_utils_end

  function new(string name = "${n}_cfg");
    super.new(name);
  endfunction
endclass
`);

  /* ---------------- sequence item */
  files[`${n}_seq_item.sv`] = BT(`class ${n}_seq_item extends uvm_sequence_item;
  // stimulus (DUT inputs)
${inputs.map(p => `  rand ${pad(decl(p).replace(/^logic/, 'bit'), 20)}${p.name};`).join('\n') || '  // (no DUT inputs)'}
  // response (DUT outputs, filled by the monitor)
${outputs.map(p => `  ${pad(decl(p).replace(/^logic/, 'bit'), 25)}${p.name};`).join('\n') || '  // (no DUT outputs)'}
  rand int unsigned delay;

  constraint c_delay { delay inside {[0:3]}; }

  §uvm_object_utils_begin(${n}_seq_item)
${all.map(p => `    §uvm_field_int(${p.name}, UVM_ALL_ON${p.dir === 'input' ? '' : ' | UVM_NOCOMPARE'})`).join('\n')}
    §uvm_field_int(delay, UVM_ALL_ON | UVM_NOCOMPARE | UVM_NOPRINT)
  §uvm_object_utils_end

  function new(string name = "${n}_seq_item");
    super.new(name);
  endfunction

  virtual function string convert2string();
    return $sformatf("${all.map(p => p.name + '=%0h').join(' ')}"${all.length ? ', ' + all.map(p => p.name).join(', ') : ''});
  endfunction
endclass
`);

  /* ---------------- sequences */
  const zeroCons = inputs.filter(p => (p.width || 2) > 1).slice(0, 3);
  files[`${n}_sequences.sv`] = BT(`// ---------------------------------------------------------------- base
class ${n}_base_seq extends uvm_sequence #(${n}_seq_item);
  §uvm_object_utils(${n}_base_seq)
  function new(string name = "${n}_base_seq");
    super.new(name);
  endfunction
endclass

// ---------------------------------------------------------------- fully random
class ${n}_random_seq extends ${n}_base_seq;
  §uvm_object_utils(${n}_random_seq)
  rand int unsigned num_items = 50;
  constraint c_num { num_items inside {[20:200]}; }

  function new(string name = "${n}_random_seq");
    super.new(name);
  endfunction

  virtual task body();
    repeat (num_items) begin
      req = ${n}_seq_item::type_id::create("req");
      start_item(req);
      if (!req.randomize()) §uvm_error(get_type_name(), "randomize failed")
      finish_item(req);
    end
  endtask
endclass

// ---------------------------------------------------------------- corner values (0 / all-ones) to close coverage holes
class ${n}_corner_seq extends ${n}_base_seq;
  §uvm_object_utils(${n}_corner_seq)
  function new(string name = "${n}_corner_seq");
    super.new(name);
  endfunction

  virtual task body();
    for (int k = 0; k < 4; k++) begin
      req = ${n}_seq_item::type_id::create("req");
      start_item(req);
      if (!req.randomize() with {
${zeroCons.length ? zeroCons.map(p => `        (k == 0) -> ${p.name} == 0;\n        (k == 1) -> ${p.name} == '1;`).join('\n') : '        delay == 0;'}
      }) §uvm_error(get_type_name(), "randomize failed")
      finish_item(req);
    end
  endtask
endclass

// ---------------------------------------------------------------- idle cycles
class ${n}_idle_seq extends ${n}_base_seq;
  §uvm_object_utils(${n}_idle_seq)
  rand int unsigned cycles = 10;
  function new(string name = "${n}_idle_seq");
    super.new(name);
  endfunction

  virtual task body();
    repeat (cycles) begin
      req = ${n}_seq_item::type_id::create("req");
      start_item(req);
      if (!req.randomize() with { delay == 0; ${inputs.filter(p => /valid|en|req|start|wr|rd/i.test(p.name) && (p.width || 1) === 1).map(p => `${p.name} == 0;`).join(' ')} }) §uvm_error(get_type_name(), "randomize failed")
      finish_item(req);
    end
  endtask
endclass

// ---------------------------------------------------------------- reset sequence: all inputs low for N cycles
class ${n}_reset_seq extends ${n}_base_seq;
  §uvm_object_utils(${n}_reset_seq)
  rand int unsigned cycles = 5;
  function new(string name = "${n}_reset_seq");
    super.new(name);
  endfunction

  virtual task body();
    repeat (cycles) begin
      req = ${n}_seq_item::type_id::create("req");
      start_item(req);
      if (!req.randomize() with { delay == 0; ${inputs.map(p => `  ${p.name} == 0;`).join('')} }) §uvm_error(get_type_name(), "randomize failed")
      finish_item(req);
    end
  endtask
endclass
${C.seqs ? '\n' + C.seqs : ''}`);

  files[`${n}_sequencer.sv`] = `typedef uvm_sequencer #(${n}_seq_item) ${n}_sequencer;\n`;

  /* ---------------- driver */
  files[`${n}_driver.sv`] = BT(`class ${n}_driver extends uvm_driver #(${n}_seq_item);
  §uvm_component_utils(${n}_driver)
  ${n}_cfg        cfg;
  virtual ${n}_if vif;

  function new(string name, uvm_component parent);
    super.new(name, parent);
  endfunction

  virtual function void build_phase(uvm_phase phase);
    super.build_phase(phase);
    if (!uvm_config_db#(${n}_cfg)::get(this, "", "cfg", cfg)) §uvm_fatal("NOCFG", "${n}_cfg not set")
    vif = cfg.vif;
  endfunction

  virtual task run_phase(uvm_phase phase);
    drive_idle();
    forever begin
      if (${inReset}) begin
        drive_idle();
        @(${activeLow ? 'posedge' : 'negedge'} vif.${rst});
        continue;
      end
      seq_item_port.get_next_item(req);
      §uvm_info(get_type_name(), {"drive: ", req.convert2string()}, UVM_HIGH)
      drive_item(req);
      seq_item_port.item_done();
    end
  endtask

  virtual task drive_idle();
${inputs.map(p => `    vif.drv_cb.${p.name} <= '0;`).join('\n') || '    // nothing to drive'}
  endtask

  virtual task drive_item(${n}_seq_item it);
    repeat (it.delay) @(vif.drv_cb);
${inputs.map(p => `    vif.drv_cb.${p.name} <= it.${p.name};`).join('\n')}
${hasHandshake ? `    do @(vif.drv_cb); while (vif.drv_cb.${readySig} !== 1'b1 && it.${validSig});
    vif.drv_cb.${validSig} <= 1'b0;` : '    @(vif.drv_cb);'}
  endtask
endclass
`);

  /* ---------------- monitor */
  files[`${n}_monitor.sv`] = BT(`class ${n}_monitor extends uvm_monitor;
  §uvm_component_utils(${n}_monitor)
  ${n}_cfg        cfg;
  virtual ${n}_if vif;
  uvm_analysis_port #(${n}_seq_item) ap;
  int unsigned n_items;

  function new(string name, uvm_component parent);
    super.new(name, parent);
    ap = new("ap", this);
  endfunction

  virtual function void build_phase(uvm_phase phase);
    super.build_phase(phase);
    if (!uvm_config_db#(${n}_cfg)::get(this, "", "cfg", cfg)) §uvm_fatal("NOCFG", "${n}_cfg not set")
    vif = cfg.vif;
  endfunction

  virtual task run_phase(uvm_phase phase);
    forever begin
      @(vif.mon_cb);
      if (${monReset}) continue;
${hasHandshake ? `      if (!(vif.mon_cb.${validSig} && vif.mon_cb.${readySig})) continue;   // sample on handshake` : '      // samples every clock; add a qualifier (valid/enable) here if the DUT has one'}
      begin
        ${n}_seq_item it = ${n}_seq_item::type_id::create("it");
${all.map(p => `        it.${p.name} = vif.mon_cb.${p.name};`).join('\n')}
        n_items++;
        ap.write(it);
      end
    end
  endtask

  virtual function void report_phase(uvm_phase phase);
    §uvm_info(get_type_name(), $sformatf("observed %0d transactions", n_items), UVM_LOW)
  endfunction
endclass
`);

  /* ---------------- coverage */
  if (f.coverage) {
    const cps = all.filter(p => (p.width || 1) <= 64);
    const small = inputs.filter(p => (p.width || 1) <= 2).slice(0, 2);
    files[`${n}_coverage.sv`] = BT(`// Functional coverage collector — open the coverage report in 10xEngineers EDA to see hit bins / holes
class ${n}_coverage extends uvm_subscriber #(${n}_seq_item);
  §uvm_component_utils(${n}_coverage)
  ${n}_seq_item tr;
${C.covMembers || ''}
  int unsigned n_sampled;
  // Covergroups need Questa / VCS / Xcelium; Verilator ignores them, so they are compiled out there
  // (the testbench's own bins and the scoreboard still run everywhere).
§ifndef VERILATOR
  covergroup ${n}_cg;
    option.per_instance = 1;
    option.name = "${n}_cg";
${C.cov ? C.cov : cps.map(p => { const b = binsFor(p); return `    cp_${p.name}: coverpoint tr.${p.name}${b || ';'}`; }).join('\n') + (small.length === 2 ? `\n    x_${small[0].name}_${small[1].name}: cross cp_${small[0].name}, cp_${small[1].name};` : '')}
  endgroup
§endif

  function new(string name, uvm_component parent);
    super.new(name, parent);
§ifndef VERILATOR
    ${n}_cg = new();
§endif
  endfunction

  virtual function void write(${n}_seq_item t);
    tr = t;
    n_sampled++;
${C.covPre || ''}§ifndef VERILATOR
    ${n}_cg.sample();
§endif
  endfunction

  virtual function void report_phase(uvm_phase phase);
§ifndef VERILATOR
    §uvm_info(get_type_name(), $sformatf("${n}_cg coverage = %0.2f%% (%0d samples)", ${n}_cg.get_inst_coverage(), n_sampled), UVM_LOW)
§else
    §uvm_info(get_type_name(), $sformatf("covergroup ${n}_cg not collected on Verilator (%0d samples seen); run on Questa/VCS for covergroup coverage", n_sampled), UVM_LOW)
§endif
  endfunction
endclass
`);
  }

  /* ---------------- scoreboard */
  if (f.scoreboard) {
    files[`${n}_scoreboard.sv`] = BT(`// Scoreboard with a reference-model hook. Implement predict() to model the DUT.
class ${n}_scoreboard extends uvm_scoreboard;
  §uvm_component_utils(${n}_scoreboard)
  uvm_analysis_imp #(${n}_seq_item, ${n}_scoreboard) imp;
  ${n}_seq_item expected_q[$];
  int unsigned n_match, n_mismatch, n_seen;
  bit          model_enabled = ${C.predict ? 1 : 0};   // set to 1 once predict() is implemented
${C.modelDecls || ''}

  function new(string name, uvm_component parent);
    super.new(name, parent);
    imp = new("imp", this);
  endfunction

  // Reference model: compute expected DUT outputs from the observed inputs.
  virtual function ${n}_seq_item predict(${n}_seq_item obs);
    ${n}_seq_item exp = ${n}_seq_item::type_id::create("exp");
    exp.copy(obs);
${C.predict ? '    begin\n' + C.predict + '\n    end' : '    // TODO: exp.<output> = f(obs.<inputs>);'}
    return exp;
  endfunction

  virtual function void write(${n}_seq_item t);
    ${n}_seq_item exp;
    n_seen++;
    if (!model_enabled) return;
    exp = predict(t);
${outputs.length ? `    if (${outputs.map(p => `exp.${p.name} !== t.${p.name}`).join(' || ')}) begin
      n_mismatch++;
      §uvm_error("SB_MISMATCH", $sformatf("expected: %s\\n  actual: %s", exp.convert2string(), t.convert2string()))
    end else n_match++;` : '    n_match++;'}
  endfunction

  virtual function void report_phase(uvm_phase phase);
    §uvm_info(get_type_name(), $sformatf("seen=%0d match=%0d mismatch=%0d%s", n_seen, n_match, n_mismatch,
              model_enabled ? "" : "  (reference model disabled — implement predict())"), UVM_LOW)
  endfunction
endclass
`);
  }

  /* ---------------- agent */
  files[`${n}_agent.sv`] = BT(`class ${n}_agent extends uvm_agent;
  §uvm_component_utils(${n}_agent)
  ${n}_cfg       cfg;
  ${n}_driver    drv;
  ${n}_monitor   mon;
  ${n}_sequencer sqr;
${f.coverage ? `  ${n}_coverage  cov;\n` : ''}
  function new(string name, uvm_component parent);
    super.new(name, parent);
  endfunction

  virtual function void build_phase(uvm_phase phase);
    super.build_phase(phase);
    if (!uvm_config_db#(${n}_cfg)::get(this, "", "cfg", cfg)) §uvm_fatal("NOCFG", "${n}_cfg not set")
    is_active = cfg.is_active;
    mon = ${n}_monitor::type_id::create("mon", this);
    if (is_active == UVM_ACTIVE) begin
      drv = ${n}_driver::type_id::create("drv", this);
      sqr = ${n}_sequencer::type_id::create("sqr", this);
    end
${f.coverage ? `    if (cfg.has_coverage) cov = ${n}_coverage::type_id::create("cov", this);\n` : ''}  endfunction

  virtual function void connect_phase(uvm_phase phase);
    if (is_active == UVM_ACTIVE) drv.seq_item_port.connect(sqr.seq_item_export);
${f.coverage ? `    if (cfg.has_coverage) mon.ap.connect(cov.analysis_export);\n` : ''}  endfunction
endclass
`);

  /* ---------------- env */
  files[`${n}_env.sv`] = BT(`class ${n}_env extends uvm_env;
  §uvm_component_utils(${n}_env)
  ${n}_agent      agt;
${f.scoreboard ? `  ${n}_scoreboard sb;\n` : ''}
  function new(string name, uvm_component parent);
    super.new(name, parent);
  endfunction

  virtual function void build_phase(uvm_phase phase);
    super.build_phase(phase);
    agt = ${n}_agent::type_id::create("agt", this);
${f.scoreboard ? `    sb  = ${n}_scoreboard::type_id::create("sb", this);\n` : ''}  endfunction

  virtual function void connect_phase(uvm_phase phase);
${f.scoreboard ? `    agt.mon.ap.connect(sb.imp);\n` : ''}  endfunction
endclass
`);

  /* ---------------- tests */
  files[`${n}_tests.sv`] = BT(`// ---------------------------------------------------------------- base test
class ${n}_base_test extends uvm_test;
  §uvm_component_utils(${n}_base_test)
  ${n}_env env;
  ${n}_cfg cfg;

  function new(string name, uvm_component parent);
    super.new(name, parent);
  endfunction

  virtual function void build_phase(uvm_phase phase);
    super.build_phase(phase);
    cfg = ${n}_cfg::type_id::create("cfg");
    if (!uvm_config_db#(virtual ${n}_if)::get(this, "", "vif", cfg.vif)) §uvm_fatal("NOVIF", "virtual ${n}_if not set by tb_top")
    if ($test$plusargs("PASSIVE")) cfg.is_active = UVM_PASSIVE;   // +PASSIVE on the vsim command line
    uvm_config_db#(${n}_cfg)::set(this, "env.agt*", "cfg", cfg);
    env = ${n}_env::type_id::create("env", this);
  endfunction

  virtual function void end_of_elaboration_phase(uvm_phase phase);
    uvm_top.print_topology();
  endfunction

  virtual task run_phase(uvm_phase phase);
    phase.raise_objection(this);
    wait (cfg.vif.${rst} === ${rstIdle});
    run_body();
    #(${period * 10}ns);
    phase.drop_objection(this);
  endtask

  // override in derived tests
  virtual task run_body();
    ${n}_random_seq seq = ${n}_random_seq::type_id::create("seq");
    if (cfg.is_active == UVM_ACTIVE) begin
      if (!seq.randomize()) §uvm_error(get_type_name(), "randomize failed")
      seq.start(env.agt.sqr);
    end else #(${period * 1000}ns);
  endtask

  virtual function void report_phase(uvm_phase phase);
    uvm_report_server rs = uvm_report_server::get_server();
    if (rs.get_severity_count(UVM_FATAL) + rs.get_severity_count(UVM_ERROR) == 0)
      §uvm_info("RESULT", "\\n*** TEST PASSED ***", UVM_NONE)
    else
      §uvm_info("RESULT", "\\n*** TEST FAILED ***", UVM_NONE)
  endfunction
endclass

// ---------------------------------------------------------------- random test
class ${n}_random_test extends ${n}_base_test;
  §uvm_component_utils(${n}_random_test)
  function new(string name, uvm_component parent);
    super.new(name, parent);
  endfunction
endclass

// ---------------------------------------------------------------- coverage-closure test: random + corner + idle
class ${n}_closure_test extends ${n}_base_test;
  §uvm_component_utils(${n}_closure_test)
  function new(string name, uvm_component parent);
    super.new(name, parent);
  endfunction

${C.closure ? '  virtual task run_body();\n    if (cfg.is_active != UVM_ACTIVE) return;\n    begin\n' + C.closure + '\n    end\n  endtask\n' : `  virtual task run_body();
    ${n}_corner_seq c = ${n}_corner_seq::type_id::create("c");
    ${n}_idle_seq   i = ${n}_idle_seq::type_id::create("i");
    ${n}_random_seq r = ${n}_random_seq::type_id::create("r");
    if (cfg.is_active != UVM_ACTIVE) return;
    c.start(env.agt.sqr);
    if (!i.randomize()) §uvm_error(get_type_name(), "randomize failed")
    i.start(env.agt.sqr);
    if (!r.randomize() with { num_items == 200; }) §uvm_error(get_type_name(), "randomize failed")
    r.start(env.agt.sqr);
  endtask
`}endclass
${C.tests || ''}`);

  /* ---------------- package */
  files[`${n}_pkg.sv`] = BT(`package ${n}_pkg;
  import uvm_pkg::*;
  §include "uvm_macros.svh"

  §include "${n}_cfg.sv"
  §include "${n}_seq_item.sv"
  §include "${n}_sequencer.sv"
  §include "${n}_sequences.sv"
  §include "${n}_driver.sv"
  §include "${n}_monitor.sv"
${f.coverage ? `  §include "${n}_coverage.sv"\n` : ''}  §include "${n}_agent.sv"
${f.scoreboard ? `  §include "${n}_scoreboard.sv"\n` : ''}  §include "${n}_env.sv"
  §include "${n}_tests.sv"
endpackage
`);

  /* ---------------- assertions (bind) */
  if (f.assertions && dutName) {
    files[`${n}_assertions.sv`] = BT(`// DUT checks (SVA) on the DUT ports - instantiated in tb_top
module ${n}_assertions (input logic ${clk}, input logic ${rst}${all.length ? ',\n' + all.map(p => `  input ${decl(p)} ${p.name}`).join(',\n') : ''});
${C.sva ? C.sva + '\n' : ''}${outputs.map(p => `  a_${p.name}_known: assert property (@(posedge ${clk}) disable iff (${activeLow ? '!' : ''}${rst}) !$isunknown(${p.name}))
    else $error("${dutName}.${p.name} is X/Z after reset");`).join('\n')}
${hasHandshake ? `  // add protocol properties here, e.g. valid must stay high until ready
` : ''}endmodule

`);
  }

  /* ---------------- tb_top */
  const dutConn = opts.dut ? opts.dut.ports.filter(p => p.dir !== 'interface').map(p => {
    if (p.name === clk) return `.${p.name}(${clk})`;
    if (p.name === rst) return `.${p.name}(${rst})`;
    return `.${p.name}(${n}_vif.${p.name})`;
  }) : [];
  files['tb_top.sv'] = BT(`§timescale 1ns/1ps
module tb_top;
  import uvm_pkg::*;
  §include "uvm_macros.svh"
  import ${n}_pkg::*;

  localparam time CLK_PERIOD = ${period}ns;

  logic ${clk} = 1'b0;
  logic ${rst} = ${rstActive};
  always #(CLK_PERIOD/2) ${clk} = ~${clk};

  initial begin
    repeat (5) @(posedge ${clk});
    ${rst} <= ${rstIdle};
  end

  ${n}_if ${n}_vif (.${clk}(${clk}), .${rst}(${rst}));

${dutName ? `  ${dutName}${params.length ? ' #(\n' + params.map(p => `    .${p.name}(${p.value})`).join(',\n') + '\n  )' : ''} u_dut (\n    ${dutConn.join(',\n    ')}\n  );` : `  // TODO: instantiate your DUT here and connect it to ${n}_vif\n  assign ${n}_vif.ready = 1'b1;   // stand-alone responder`}

${f.assertions && dutName ? `  // SVA checks on the DUT boundary (works for combinational DUTs without a clock too)
  ${n}_assertions u_${n}_assertions (.${clk}(${clk}), .${rst}(${rst})${all.map(p => `, .${p.name}(${n}_vif.${p.name})`).join('')});

` : ''}  // The interface's signals as plain wires, so they appear in waves.vcd on every simulator
  // (Questa, VCS and Xcelium do not write SystemVerilog interface contents to a VCD; Verilator does).
§ifndef VERILATOR
  if (1) begin : ${n}_if_signals
    wire ${clk} = ${n}_vif.${clk};
    wire ${rst} = ${n}_vif.${rst};
${all.map(p => `    ${decl(p).replace(/^logic/, 'wire')} ${p.name} = ${n}_vif.${p.name};`).join('\n')}
  end
§endif

  // waveform on request (+WAVES): the extension adds it for failing tests (or for every test when asked)
  initial begin
    if ($test$plusargs("WAVES")) begin
      $dumpfile("waves.vcd");    // open with 10xEngineers EDA waveform viewer
      $dumpvars(0, tb_top);
    end
  end

  initial begin
    uvm_config_db#(virtual ${n}_if)::set(null, "uvm_test_top", "vif", ${n}_vif);
    run_test("${n}_random_test");
  end
endmodule
`);

  /* ---------------- source list (paths relative to uvm/; compile from uvm/) */
  const rtl = (opts.rtlFiles || []).map(p => p.replace(/\\/g, '/'));
  const flat = opts.layout === 'flat';
  const at = (sub, file) => (flat || !sub ? file : sub + '/' + file);
  files['files.f'] = [
    '// 10xEngineers EDA source list — edit freely, or use "10xEngineers EDA: Add Files to Source List"',
    '// paths are relative to the uvm/ folder: compile from there (vlog -f files.f)',
    '+incdir+.',
    ...(flat ? [] : ['+incdir+tb', '+incdir+agent', '+incdir+sequences', '+incdir+env', '+incdir+tests']),
    ...[...new Set(rtl.map(p => p.includes('/') ? '+incdir+' + p.slice(0, p.lastIndexOf('/')) : null).filter(Boolean))],
    '// ---- RTL',
    ...rtl,
    '// ---- verification',
    at('tb', `${n}_if.sv`),
    `${n}_pkg.sv`,
    ...(f.assertions && dutName ? [at('tb', `${n}_assertions.sv`)] : []),
    at('tb', 'tb_top.sv'),
    ''
  ].join('\n');

  /* ---------------- Questa scripts */
  if (f.questa) {
    files['run.do'] = `# Questa / ModelSim run script (works on Windows and Linux)
#   vsim -c -do "do run.do ${n}_random_test"         (batch)
#   vsim    -do "do run.do ${n}_closure_test gui"    (GUI)
#   modes: batch | gui | compile.  Env: SEED, NOCOMPILE=1 (reuse library), WORKLIB=<lib dir>, UCDB=<output ucdb>
if {$argc >= 1 && "$1" ne ""} { set TEST $1 } else { set TEST ${n}_random_test }
if {$argc >= 2} { set MODE $2 } else { set MODE batch }
if {[info exists env(SEED)]} { set SEED $env(SEED) } else { set SEED random }
set UVMINC ""
if {[info exists env(UVM_HOME)]} { set UVMINC "+incdir+$env(UVM_HOME)/src" }
set HERE [file dirname [file normalize [info script]]]
# the source list is relative to the uvm/ folder (one level up from scripts/)
if {[file exists $HERE/files.f]} { set UVMDIR $HERE } else { set UVMDIR [file dirname $HERE] }
if {[info exists env(WORKLIB)]} { set WORK $env(WORKLIB) } else { set WORK $UVMDIR/work }

if {![info exists env(NOCOMPILE)]} {
  set CWD [pwd]
  cd $UVMDIR
  if {[file exists $WORK]} { vdel -lib $WORK -all }
  vlib $WORK
  eval vlog -sv -timescale 1ns/1ps +acc=npr -cover bcesft $UVMINC -work $WORK -f files.f
  cd $CWD
}
if {$MODE eq "compile"} { quit -f }
vmap work $WORK
if {[info exists env(UCDB)]} { set UCDB $env(UCDB) } else { set UCDB cov_\${TEST}_\${SEED}.ucdb }
eval vsim -coverage -onfinish stop -sv_seed $SEED +UVM_TESTNAME=$TEST +UVM_VERBOSITY=UVM_MEDIUM tb_top
coverage save -onexit $UCDB
if {$MODE eq "gui"} {
  add wave -r /tb_top/*
  run -all
} else {
  run -all
  quit -f
}
`;
    files['Makefile'] = `# Linux / WSL / Git-Bash helper.  make sim TEST=${n}_closure_test
QUESTA_HOME ?=
VSIM   = $(if $(QUESTA_HOME),$(QUESTA_HOME)/,)vsim
VCOVER = $(if $(QUESTA_HOME),$(QUESTA_HOME)/,)vcover
TEST  ?= ${n}_random_test
SEED  ?= random

sim:
\tSEED=$(SEED) $(VSIM) -c -do "do run.do $(TEST)"
\t$(VCOVER) report -details -output coverage_$(TEST).txt cov_$(TEST)_$(SEED).ucdb

gui:
\t$(VSIM) -do "do run.do $(TEST) gui"

regress:
\tfor t in ${n}_random_test ${n}_closure_test; do SEED=$(SEED) $(VSIM) -c -do "do run.do $$t"; done
\t$(VCOVER) merge merged.ucdb cov_*.ucdb
\t$(VCOVER) report -details -output coverage_merged.txt merged.ucdb

clean:
\trm -rf work transcript *.wlf *.ucdb *.vcd coverage_*.txt modelsim.ini

.PHONY: sim gui regress clean
`;
    files['run.sh'] = `#!/usr/bin/env bash
# usage: ./run.sh [test] [seed]      (set QUESTA_HOME to the Questa bin dir if vsim is not on PATH)
set -e
cd "$(dirname "$0")"
TEST=\${1:-${n}_random_test}
export SEED=\${2:-random}
BIN=\${QUESTA_HOME:+$QUESTA_HOME/}
"\${BIN}vsim" -c -do "do run.do $TEST"
"\${BIN}vcover" report -details -output "coverage_$TEST.txt" "cov_\${TEST}_\${SEED}.ucdb"
echo "Coverage report: coverage_$TEST.txt  (open it with '10xEngineers EDA: Open Coverage Report')"
`;
    files['run.bat'] = `@echo off
rem usage: run.bat [test] [seed]     (set QUESTA_HOME to the Questa win64 dir if vsim is not on PATH)
cd /d "%~dp0"
set TEST=%1
if "%TEST%"=="" set TEST=${n}_random_test
set SEED=%2
if "%SEED%"=="" set SEED=random
set BIN=
if not "%QUESTA_HOME%"=="" set BIN=%QUESTA_HOME%\\
"%BIN%vsim" -c -do "do run.do %TEST%"
"%BIN%vcover" report -details -output coverage_%TEST%.txt cov_%TEST%_%SEED%.ucdb
echo Coverage report: coverage_%TEST%.txt
`;
  }

  files['README.md'] = `# ${N} UVM environment (generated by 10xEngineers EDA)

${dutName ? `DUT: \`${dutName}\` · clock \`${clk}\` · reset \`${rst}\` (active-${activeLow ? 'low' : 'high'}) · ${inputs.length} inputs · ${outputs.length} outputs` : 'Template environment (no DUT parsed).'}

| Folder / file | Contents |
|---|---|
| ${at('tb', '')}tb_top.sv | Clock, reset, DUT, config_db, waveform dump with \`+WAVES\` |
| ${at('tb', '')}${n}_if.sv | Interface with driver/monitor clocking blocks |
${f.assertions && dutName ? `| ${at('tb', '')}${n}_assertions.sv | SVA bound into the DUT |\n` : ''}| ${at('agent', '')}${n}_cfg.sv | Agent config: \`is_active\`, \`has_coverage\`, \`has_checks\` |
| ${at('agent', '')}${n}_seq_item.sv | Transaction |
| ${at('agent', '')}${n}_sequencer.sv / _driver.sv / _monitor.sv / _agent.sv | Sequencer, pin-level driver and monitor, agent |
| ${at('sequences', '')}${n}_sequences.sv | Scenario sequences: reset, directed, corner, random |
| ${at('env', '')}${n}_env.sv | Environment |
${f.scoreboard ? `| ${at('env', '')}${n}_scoreboard.sv | Scoreboard + reference model \`predict()\` |\n` : ''}${f.coverage ? `| ${at('env', '')}${n}_coverage.sv | Functional coverage (covergroups) |\n` : ''}| ${at('tests', '')}${n}_tests.sv | base / scenario / random / closure tests |
| ${n}_pkg.sv | Package: includes all of the above |
| files.f | Source list (RTL + testbench), relative to this folder |
${f.questa ? `| ${at('scripts', '')}run.do / Makefile / run.sh / run.bat | Questa scripts (Windows + Linux) |\n` : ''}
## Run
- In VS Code / Cursor: **10xEngineers EDA: Run Questa Simulation**. It compiles, runs, writes the UCDB, produces a report and opens the coverage dashboard.
- CLI: \`vsim -c -do "do ${at('scripts', '')}run.do ${n}_closure_test"\` then \`vcover report -details -output cov.txt cov_${n}_closure_test_<seed>.ucdb\`
- Passive agent: add \`+PASSIVE\` to the vsim command line, or set \`cfg.is_active = UVM_PASSIVE\` in a derived test.
`;
  for (const k of Object.keys(files)) files[k] = files[k].replace(/[—–]/g, '-').replace(/→/g, '->');
  if (!flat) {
    let L; try { L = require('./dv/layout'); } catch (e) { L = require('./engine/layout'); }   // extension / vendored .dvflow copy
    for (const k of Object.keys(files)) { const sub = L.uvmSub(k, n); if (sub) { files[sub + '/' + k] = files[k]; delete files[k]; } }
  }
  return { files, warnings, summary: { clk, rst, activeLow, inputs: inputs.map(p => p.name), outputs: outputs.map(p => p.name), handshake: hasHandshake } };
}

module.exports = { generate };

'use strict';
/*
 * Identify what an RTL module is, from its ports, widths, name and body:
 *   identify(mod, text) -> { template, protocol, role, confidence, reasons[], alternatives[{template, score}], label }
 * Every candidate is scored; the reasons say why ("ports psel, penable, paddr -> APB slave"), so the suggestion can be
 * shown to the engineer instead of being a silent guess. Unknown designs get 'custom' with the closest alternatives.
 */
const PROTOCOLS = {
  apb: { label: 'AMBA APB', need: [/^psel/, /^penable/, /^paddr/], opt: [/^pwrite/, /^pready/, /^prdata/, /^pwdata/, /^pslverr/] },
  ahb: { label: 'AMBA AHB(-Lite)', need: [/^htrans/, /^haddr/], opt: [/^hready/, /^hwrite/, /^hsize/, /^hrdata/, /^hwdata/, /^hresp/, /^hsel/] },
  axi4lite: { label: 'AMBA AXI4-Lite', need: [/awvalid$/, /wvalid$/, /arvalid$/, /rvalid$/, /bvalid$/], opt: [/awready$/, /wready$/, /bready$/, /arready$/, /rready$/] },
  axis: { label: 'AMBA AXI-Stream', need: [/tvalid$/, /tdata$/], opt: [/tready$/, /tlast$/, /tkeep$/, /tuser$/] },
  wishbone: { label: 'Wishbone', need: [/^(wb_)?cyc(_i|_o)?$/, /^(wb_)?stb(_i|_o)?$/, /^(wb_)?ack(_i|_o)?$/], opt: [/^(wb_)?we(_i|_o)?$/, /^(wb_)?adr(_i|_o)?$/, /^(wb_)?dat(_i|_o)?$/, /^(wb_)?sel(_i|_o)?$/] },
  spi: { label: 'SPI', need: [/^(sclk|sck|spi_clk)$/, /^(mosi|sdo|copi)$/, /^(miso|sdi|cipo)$/], opt: [/^(cs_n|ss_n|csn|ssn|cs|ss)$/] },
  i2c: { label: 'I²C', need: [/^scl/, /^sda/], opt: [] },
  uart: { label: 'UART', need: [/^(tx|rx|uart_tx|uart_rx|txd|rxd)$/], opt: [/baud|clks_per_bit|tx_start|tx_busy|rx_valid|tx_data|rx_data/] }
};
const LABELS = {
  gate: 'logic gate', adder: 'adder', subtractor: 'subtractor', add_sub: 'adder-subtractor', multiplier: 'multiplier', comparator: 'comparator',
  alu: 'ALU', mux: 'multiplexer', demux: 'demultiplexer', encoder: 'encoder', priority_encoder: 'priority encoder', decoder: 'decoder',
  code_converter: 'code converter', parity: 'parity generator/checker', crc: 'CRC', hamming: 'Hamming code', dff: 'flip-flop / register', latch: 'latch',
  shift_register: 'shift register', counter: 'counter', updown_counter: 'up/down counter', lfsr: 'LFSR', pc: 'program counter', register_file: 'register file',
  memory: 'memory', fifo: 'FIFO', pipeline: 'valid/ready pipeline', fsm: 'state machine', custom: 'custom design'
};

const strip = t => String(t || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
function identify(mod, text) {
  const name = String(mod.name || '').toLowerCase();
  const ports = (mod.ports || []).map(p => ({ name: String(p.name).toLowerCase(), dir: p.dir, width: p.width || 1 }));
  const ins = ports.filter(p => p.dir === 'input'), outs = ports.filter(p => p.dir === 'output');
  const has = re => ports.some(p => re.test(p.name));
  const hasIn = re => ins.some(p => re.test(p.name));
  const hasOut = re => outs.some(p => re.test(p.name));
  const body = strip(text).toLowerCase();
  const clk = ins.find(p => /^(clk|clock|clk_i|i_clk|pclk|hclk|aclk|sys_clk)$/.test(p.name));
  const seq = !!clk || /always_ff|always\s*@\s*\(\s*(pos|neg)edge/.test(body) || ins.some(p => /^(w|r|wr|rd|in|out|tx|rx)_?clk$/.test(p.name));
  const scores = {};
  const why = {};
  const add = (t, s, r) => { scores[t] = (scores[t] || 0) + s; (why[t] = why[t] || []).push(r); };
  const nm = re => re.test(name);

  /* ---------------- protocols (identified separately; they also suggest a template) */
  let protocol = null, role = null;
  const pScores = [];
  for (const [k, p] of Object.entries(PROTOCOLS)) {
    const need = p.need.filter(re => has(re)).length;
    if (need < p.need.length && !(k === 'uart' && need && nm(/uart/))) continue;
    const opt = p.opt.filter(re => has(re)).length;
    pScores.push({ k, s: need * 3 + opt + (nm(new RegExp(k.replace('4lite', ''))) ? 3 : 0) });
  }
  pScores.sort((a, b) => b.s - a.s);
  const protocols = pScores.map(p => p.k);
  if (pScores.length) {
    protocol = pScores[0].k;
    const P = PROTOCOLS[protocol];
    const outPort = re => outs.some(p => re.test(p.name));
    role = protocol === 'apb' ? (outPort(/^psel/) ? 'master' : 'slave') : protocol === 'ahb' ? (outPort(/^htrans/) ? 'master' : 'slave')
      : protocol === 'axi4lite' ? (outPort(/awvalid$/) ? 'master' : 'slave') : protocol === 'axis' ? (hasIn(/^s_?axis?_?tvalid|^s_tvalid/) && hasOut(/^m_?axis?_?tvalid|^m_tvalid/) ? 'pass-through' : outPort(/tvalid$/) ? 'master' : 'slave')
      : protocol === 'wishbone' ? (outPort(/^(wb_)?ack/) ? 'slave' : 'master') : protocol === 'spi' ? (outPort(/^(sclk|sck|spi_clk)$/) ? 'master' : 'slave')
      : protocol === 'i2c' ? (outPort(/^scl/) ? 'master' : 'slave') : protocol === 'uart' ? (hasOut(/^(tx|txd|uart_tx)$/) && hasIn(/^(rx|rxd|uart_rx)$/) ? 'transceiver' : hasOut(/^(tx|txd|uart_tx)$/) ? 'transmitter' : 'receiver') : null;
    // a bus / serial protocol block is verified with transactions on that protocol, never with a generic counter/memory/pipeline model;
    // AXI-Stream is the exception (a stream FIFO or register slice really is a FIFO / pipeline)
    add('custom', protocol === 'axis' ? 2 : 16, `${P.label} ${role || ''} ${protocol === 'axis' ? 'interface' : 'protocol block: verify with bus transactions'} (${ports.filter(p => P.need.concat(P.opt).some(re => re.test(p.name))).map(p => p.name).slice(0, 6).join(', ')})`.replace('  ', ' '));
    if (protocol === 'axis' && (nm(/fifo/) || (has(/full/) && has(/empty/)))) add('fifo', 6, 'AXI-Stream FIFO');
    else if (protocol === 'axis') add('pipeline', 5, 'AXI-Stream valid/ready data path');
  }

  // latches have no clock but are not combinational
  if (nm(/latch/) || /always_latch/.test(body)) add('latch', 20, 'latch name / always_latch');   // decisive: outweighs the mux-like ports of a latched mux

  /* ---------------- combinational families */
  if (!seq) {
    const gateOp = s => (/nand/.test(s) ? 'nand' : /xnor/.test(s) ? 'xnor' : /nor/.test(s) ? 'nor' : /xor/.test(s) ? 'xor' : /(^|_)and|^and/.test(s) ? 'and' : /(^|_)or|^or/.test(s) ? 'or' : /not|inv/.test(s) ? 'not' : /buf/.test(s) ? 'buf' : null);
    if (gateOp(name) || nm(/gate/) || outs.some(o => gateOp(o.name) && /_o$|_out$|^y_/.test(o.name))) add('gate', nm(/gate/) ? 6 : gateOp(name) ? 7 : 5, `logic-gate name ('${mod.name}')`);
    if (hasOut(/^(sum|s|sum_o)$/) || hasOut(/^(cout|co|carry|carry_out)$/) || nm(/add/)) add('adder', 6, 'sum / carry ports');
    if (hasOut(/diff|borrow/) || hasIn(/^(bin|borrow_in)$/) || nm(/sub/)) add('subtractor', 7, 'difference / borrow ports');
    if (nm(/add_?sub|addsub/) || (hasIn(/^(mode|sub|add_sub|m|op_sub)$/) && (hasOut(/sum|result|res/)))) add('add_sub', 9, 'add/subtract mode input');
    if (nm(/mul|mult/) || hasOut(/^(p|prod|product)$/)) add('multiplier', 7, 'product output');
    if (outs.filter(o => /^(eq|lt|gt|equal|less|greater|a_eq_b|a_lt_b|a_gt_b|le|ge|ne)$/.test(o.name)).length >= 2 || nm(/comp|cmp/)) add('comparator', 8, 'eq / lt / gt outputs');
    if (nm(/alu/) || (hasIn(/^(op|opcode|alu_op|alu_sel|func|funct|ctrl|alu_ctrl)$/) && hasOut(/result|res|out|y/) && ins.length >= 3)) add('alu', 8, 'operation-select input with a result output');
    const sel = ins.find(p => /^(sel|s|select|sel_i|addr)$/.test(p.name) || /sel/.test(p.name));
    const data = ins.filter(p => p !== sel && !/^(en|enable|oe)$/.test(p.name));
    if (sel && nm(/demux|dmux/)) add('demux', 9, 'name says demux');
    if (sel && nm(/(^|_)mux|multiplexer/) && !nm(/demux/)) add('mux', 9, 'name says mux');
    if (sel && outs.length === 1 && data.length >= 2 && data.every(d => d.width === outs[0].width)) add('mux', 6, `select input '${sel.name}' choosing between ${data.length} equal-width inputs`);
    if (sel && outs.length === 1 && data.length === 1 && data[0].width > outs[0].width && data[0].width % outs[0].width === 0) add('mux', 6, `select input '${sel.name}' slicing a ${data[0].width}-bit input`);
    if (sel && data.length === 1 && (outs.length >= 2 || (outs[0] && outs[0].width > data[0].width))) add('demux', 6, `one data input '${data[0].name}' routed to several outputs by '${sel.name}'`);
    const i1 = ins.filter(p => !/^(en|enable)$/.test(p.name));
    const W = n => Math.log2(n);
    if (nm(/prio|priority/) || (hasOut(/valid|^v$/) && i1.length === 1 && outs.some(o => Number.isInteger(W(i1[0].width)) && o.width === W(i1[0].width)))) add('priority_encoder', nm(/prio/) ? 9 : 6, 'one-hot/priority input with an index output and a valid flag');
    if (nm(/enc/) && !nm(/prio/)) add('encoder', 8, 'name says encoder');
    if (i1.length === 1 && outs.length >= 1 && Number.isInteger(W(i1[0].width)) && i1[0].width > 2 && outs[0].width === W(i1[0].width)) add('encoder', 5, `${i1[0].width}-bit input -> ${outs[0].width}-bit index`);
    if (nm(/seven|7seg|seg7|sevenseg/) || hasOut(/^(seg|segs|segments|hex)$/)) add('decoder', 9, '7-segment outputs');
    if (nm(/dec/) && !nm(/prio/)) add('decoder', 7, 'name says decoder');
    if (i1.length === 1 && outs.length === 1 && outs[0].width === 2 ** i1[0].width && i1[0].width <= 6) add('decoder', 6, `${i1[0].width}-bit input -> ${outs[0].width}-bit one-hot output`);
    if (nm(/onehot|one_hot|1hot/)) add('encoder', 10, 'one-hot to binary');
    else if (nm(/gray|bcd|bin2|2bin|to_bin|convert/)) add('code_converter', 9, 'code-conversion name (Gray / BCD / binary)');
    if (nm(/sat(urat)?/)) add('custom', 12, 'saturating arithmetic (clamps instead of wrapping)');
    if (nm(/fixed|float|fp_|_fp|fpu|bcd_?add|add_?bcd|adder_bcd/)) add('custom', 12, 'fixed-point / floating-point / BCD arithmetic');
    if (nm(/parity/) || hasOut(/parity|par$|^p$/) && nm(/par/)) add('parity', 9, 'parity name / output');
    if (nm(/(^|_)(rom|ram|mem)(_|\d|$)/) && hasIn(/addr|address|^a$/)) add('memory', 10, 'memory name with an address input');
    if (nm(/crc/)) add('crc', 10, 'CRC name');
    if (nm(/hamming|ecc|secded/)) add('hamming', 10, 'Hamming / ECC name');
  }

  /* ---------------- sequential families */
  if (seq) {
    const hasAddr = has(/^(addr|address|adr|waddr|raddr|a)$/);
    if (nm(/lifo|stack/)) add('custom', 14, 'LIFO / stack (last in, first out)');
    if (nm(/fifo|queue/) || (has(/^full$/) && has(/^empty$/))) add('fifo', 10, 'FIFO name / full and empty flags');
    if ((hasIn(/^(ra1|ra2|rs1|rs2|raddr1|raddr2|rd_addr1|rd_addr2|read_reg1|read_reg2)$/) && hasIn(/^(wa|rd|waddr|wr_addr|write_reg)$/)) || nm(/reg_?file|regfile|register_?file/)) add('register_file', 11, 'two read-address ports and a write port');
    if (!nm(/fifo/) && (nm(/ram|rom|mem|sram/) || (hasAddr && hasIn(/^(we|wr_en|wen|write_en|wr)$/)))) add('memory', 9, 'address + write-enable ports');
    if (hasIn(/^(waddr|wr_addr|write_addr|addr_a|addra)$/) && hasIn(/^(raddr|rd_addr|read_addr|addr_b|addrb)$/)) add('custom', 14, 'dual-port RAM (separate read and write addresses)');
    if (nm(/lfsr|prbs/)) add('lfsr', 10, 'LFSR / PRBS name');
    if (nm(/^pc$|program_?counter|(^|_)pc(_|$)/) || hasOut(/^(pc|pc_out|pc_o)$/)) add('pc', 10, 'program-counter name / pc output');
    if (nm(/up_?down|updn|udc/) || (hasIn(/^(up|dir|up_dn|updown|up_down|down)$/) && (nm(/cnt|count/) || hasOut(/count|cnt/)))) add('updown_counter', 9, 'up/down direction input on a counter');
    if (nm(/count|cnt|timer/) && !nm(/up_?down/)) add('counter', nm(/ring|johnson|gray|(^|_)jc(_|$)/) ? 4 : 7, nm(/mod_?\d+|decade|bcd/) ? 'mod-N counter name' : 'counter name');
    if (nm(/ring|johnson|gray|(^|_)jc(_|$)/)) add('custom', 12, 'special counter sequence (ring / Johnson / Gray): not a binary count');
    if (nm(/(^|_)(t|jk|sr)_?ff|tff|jkff|srff|t_flip|jk_flip/)) add('custom', 12, 'T / JK / SR flip-flop (not a D flip-flop)');
    if (nm(/shift|sipo|piso|siso|pipo|shreg|parallel_?2_?serial|serial_?2_?parallel|p2s|s2p|ser(ial)?_?to_?par|par(allel)?_?to_?ser/) || hasIn(/^(sin|serial_in|si)$/) || hasOut(/^(sout|serial_out|so)$/)) add('shift_register', 8, 'serial in/out or shift name');
    if (nm(/mul|mult|div|add|sub|mac|fft|sqrt/) && (nm(/pipe/) || (has(/valid/) && has(/ready/)))) add('custom', 10, 'pipelined arithmetic (the result is computed, not passed through)');
    if (nm(/pipe|stage|skid|delay/) || (has(/valid/) && has(/ready/))) add('pipeline', 6, 'valid/ready or pipeline name');
    if (/\b(typedef\s+enum|enum\s+(logic|bit)?)/.test(body) && /case\s*\(\s*\w*state/.test(body) || (nm(/fsm|state|seq_?det|sequence|vending|traffic|arbiter|controller|ctrl|elevator/) && !nm(/edge/))) add('fsm', /typedef\s+enum|localparam.*(idle|s0)/.test(body) ? 8 : 6, 'state register with case-based next-state logic');
    if (nm(/dff|flop|^ff|_ff$|^reg|_reg$|register$/) || (hasOut(/^q$/) && hasIn(/^d$/))) add('dff', 7, 'D input / Q output');
    if (/[+]\s*1|\+\s*'d1|\+\s*1'b1/.test(body) && hasOut(/count|cnt|q/) && !scores.counter) add('counter', 4, 'increments a register');
    if (nm(/crc/)) add('crc', 10, 'CRC name');
  }

  /* ---------------- choose */
  if (!Object.keys(scores).length) add('custom', 1, 'no known pattern in the port names or the module name');
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [template, top] = ranked[0];
  const second = ranked[1] ? ranked[1][1] : 0;
  const confidence = template === 'custom' ? 'low' : top >= 9 && top - second >= 3 ? 'high' : top >= 6 ? 'medium' : 'low';
  const label = `${LABELS[template] || template}${protocol ? ` · ${PROTOCOLS[protocol].label}${role ? ' ' + role : ''}` : ''}${protocols.length > 1 ? ` (+ ${protocols.slice(1).map(k => PROTOCOLS[k].label).join(', ')})` : ''}`;
  return { template, protocol, protocols, role, sequential: seq, confidence, label, reasons: why[template] || [], alternatives: ranked.slice(1, 4).map(([t, s]) => ({ template: t, score: s, label: LABELS[t] || t })) };
}

module.exports = { identify, PROTOCOLS, LABELS };

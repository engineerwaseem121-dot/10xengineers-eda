'use strict';
/*
 * Expression-based templates for combinational blocks.
 *
 * Each template maps the DUT's ports to roles and writes every output's expected value as an expression over the
 * inputs (the same language as dvflow.json → behavior.checks). exprModel() turns those expressions into a model
 * for every testbench: SystemVerilog checks (SV testbench, UVM, formal) and Python (cocotb), plus scenarios
 * (directed corners, exhaustive when small, seeded random) and coverage bins.
 *
 *   TEMPLATE_SPECS[id](cfg, ports) -> { checks: {out: expr}, bins, directed, random, noExhaustive, note, reqText }
 *   exprModel(cfg, ports, spec, prefix)  -> template model (same shape as templates.js models)
 *   customExprModel(cfg, ports)          -> custom template with written behavior.checks (combinational)
 */
const expr = require('./expr');

const isClkRst = (cfg, p) => p.name === (cfg.clock && cfg.clock.name) || p.name === (cfg.reset && cfg.reset.name);
const dataIns = (cfg, ports) => ports.filter(p => p.dir === 'input' && !isClkRst(cfg, p));
const outsOf = ports => ports.filter(p => p.dir === 'output');
const W = p => Math.max(1, p.width || 1);
const sized = (w, v) => `${w}'d${BigInt(v)}`;
const idx = name => { const m = /(\d+)(?:_?[a-z]*)?$/i.exec(name); return m ? Number(m[1]) : null; };
const by = re => ps => ps.find(p => re.test(p.name));
class MapError extends Error {}
const need = (x, what) => { if (!x) throw new MapError(what); return x; };
/** order data inputs: d0,d1,… / in0,in1 / i0 by their number, otherwise a,b,c… alphabetically */
const ordered = ps => {
  const numbered = ps.filter(p => idx(p.name) != null);
  return numbered.length === ps.length ? [...ps].sort((a, b) => idx(a.name) - idx(b.name)) : [...ps].sort((a, b) => a.name.localeCompare(b.name));
};

/* ================================================================ templates */
const GATE_OPS = {
  and: (a, b) => `${a} & ${b}`, or: (a, b) => `${a} | ${b}`, xor: (a, b) => `${a} ^ ${b}`,
  nand: (a, b) => `~(${a} & ${b})`, nor: (a, b) => `~(${a} | ${b})`, xnor: (a, b) => `~(${a} ^ ${b})`
};
const RED = { and: '&', or: '|', xor: '^', nand: '~&', nor: '~|', xnor: '~^' };
const gateOpOf = s => (/nand/.test(s) ? 'nand' : /xnor/.test(s) ? 'xnor' : /nor/.test(s) ? 'nor' : /xor/.test(s) ? 'xor' : /(^|_)and|^and/.test(s) ? 'and' : /(^|_)or|^or/.test(s) ? 'or' : /not|inv/.test(s) ? 'not' : /buf/.test(s) ? 'buf' : null);

function gate(cfg, ports) {
  const ins = ordered(dataIns(cfg, ports)), outs = outsOf(ports);
  need(ins.length && outs.length, 'a gate needs at least one input and one output');
  const modOp = gateOpOf(String(cfg.dut.top).toLowerCase());
  const checks = {};
  for (const o of outs) {
    const op = gateOpOf(o.name.toLowerCase()) || modOp;
    need(op, `cannot tell which gate drives '${o.name}' (name the module or the output and2 / or_o / nand_y …)`);
    if (op === 'not' || op === 'buf') { checks[o.name] = op === 'not' ? `~${ins[0].name}` : ins[0].name; continue; }
    if (ins.length === 1 && W(ins[0]) > 1 && W(o) === 1) { checks[o.name] = `${RED[op]}${ins[0].name}`; continue; }   // N-input gate on a vector
    const base = op.replace(/^n(?!ot)|^x?n(?=or)/, '');
    const inner = op === 'nand' ? 'and' : op === 'nor' ? 'or' : op === 'xnor' ? 'xor' : op;
    const chain = ins.map(p => p.name).reduce((acc, n) => (acc ? GATE_OPS[inner](acc, n) : n), '');
    checks[o.name] = inner === op ? chain : `~(${chain})`;
    void base;
  }
  return { checks, note: 'logic gate', reqText: 'Each output shall be the logic function named by the design (AND, OR, NAND, NOR, XOR, XNOR, NOT, BUF) of the inputs.' };
}

function selAndData(cfg, ports) {
  const ins = dataIns(cfg, ports);
  const sel = need(ins.find(p => /^(sel|s|select|sel_i|i_sel)$/i.test(p.name)) || ins.find(p => /sel/i.test(p.name)), 'no select input (sel / s / select)');
  const en = ins.find(p => /^(en|enable|oe|e)$/i.test(p.name));
  return { sel, en, data: ordered(ins.filter(p => p !== sel && p !== en)) };
}
function mux(cfg, ports) {
  const { sel, en, data } = selAndData(cfg, ports);
  const out = need(outsOf(ports)[0], 'no output');
  const ow = W(out);
  let choices;
  if (data.length === 1 && W(data[0]) > ow && W(data[0]) % ow === 0) {
    const n = W(data[0]) / ow;
    choices = Array.from({ length: n }, (_, k) => `${data[0].name}[${(k + 1) * ow - 1}:${k * ow}]`);
  } else {
    need(data.length >= 2, 'a mux needs at least two data inputs or one packed input');
    choices = data.map(p => p.name);
  }
  const n = choices.length;
  let e = n === 2 ** W(sel) ? choices[n - 1] : sized(ow, 0);
  for (let k = (n === 2 ** W(sel) ? n - 2 : n - 1); k >= 0; k--) e = `${sel.name} == ${k} ? ${choices[k]} : ${e}`;
  const checks = { [out.name]: en ? `${en.name} ? (${e}) : ${sized(ow, 0)}` : e };
  const bins = Array.from({ length: Math.min(n, 64) }, (_, k) => ({ id: `SEL_${k}`, desc: `${sel.name} == ${k}`, cond: `${sel.name} == ${k}` }));
  return { checks, bins, note: `${n}:1 multiplexer`, reqText: `${out.name} shall equal the data input selected by ${sel.name} (input k when ${sel.name} = k)${en ? `, and 0 when ${en.name} = 0` : ''}.` };
}
function demux(cfg, ports) {
  const { sel, en, data } = selAndData(cfg, ports);
  const din = need(data[0], 'no data input');
  const outs = ordered(outsOf(ports));
  const dw = W(din);
  const checks = {};
  const gate_ = k => `${en ? `${en.name} && ` : ''}${sel.name} == ${k}`;
  if (outs.length === 1 && W(outs[0]) > dw && W(outs[0]) % dw === 0) {
    const n = W(outs[0]) / dw;
    checks[outs[0].name] = `{${Array.from({ length: n }, (_, j) => n - 1 - j).map(k => `(${gate_(k)}) ? ${din.name} : ${sized(dw, 0)}`).join(', ')}}`;
  } else outs.forEach((o, k) => { checks[o.name] = `(${gate_(k)}) ? ${din.name} : ${sized(W(o), 0)}`; });
  const n = outs.length === 1 ? W(outs[0]) / dw : outs.length;
  return { checks, bins: Array.from({ length: Math.min(n, 64) }, (_, k) => ({ id: `SEL_${k}`, desc: `${sel.name} == ${k}`, cond: `${sel.name} == ${k}` })), note: `1:${n} demultiplexer`, reqText: `Output k shall carry ${din.name} when ${sel.name} = k${en ? ` and ${en.name} = 1` : ''}; every other output shall be 0.` };
}
function encoderLike(cfg, ports, priority) {
  const ins = dataIns(cfg, ports);
  const en = ins.find(p => /^(en|enable|ei)$/i.test(p.name));
  const din = need(ins.find(p => p !== en && W(p) > 1), 'no multi-bit input');
  const outs = outsOf(ports);
  const valid = outs.find(o => /^(valid|v|vld|any|gs|zero_n)$/i.test(o.name));
  const out = need(outs.find(o => o !== valid && W(o) >= Math.ceil(Math.log2(W(din)))), 'no index output');
  const n = W(din);
  let e = sized(W(out), 0);
  for (let k = 0; k < n; k++) e = `${din.name}[${k}] ? ${sized(W(out), k)} : ${e}`;   // highest set bit wins (identical for one-hot inputs)
  const checks = { [out.name]: en ? `${en.name} ? (${e}) : ${sized(W(out), 0)}` : e };
  if (valid) checks[valid.name] = en ? `${en.name} && (|${din.name})` : `|${din.name}`;
  const spec = { checks, note: priority ? 'priority encoder (highest set bit wins)' : 'binary encoder (one-hot input)',
    reqText: priority ? `${out.name} shall be the index of the highest set bit of ${din.name}${valid ? `; ${valid.name} shall be 1 when any bit is set` : ''}. (If your design gives priority to bit 0, edit behavior.checks.)` : `${out.name} shall be the index of the single set bit of the one-hot input ${din.name}.`,
    bins: Array.from({ length: Math.min(n, 32) }, (_, k) => ({ id: `HOT_${k}`, desc: `highest set bit = ${k}`, cond: `${din.name} >= ${sized(n, 1n << BigInt(k))} && ${din.name} < ${sized(n + 1, 1n << BigInt(k + 1))}` })) };
  if (!priority) {   // only one-hot inputs are defined for a plain encoder
    spec.random = { [din.name]: { sv: `${n}'(1) << ($urandom % ${n})`, py: `1 << rnd.randrange(${n})` } };
    spec.directed = Array.from({ length: n }, (_, k) => ({ [din.name]: 1n << BigInt(k) }));
    spec.noExhaustive = true;
  }
  return spec;
}
function decoder(cfg, ports) {
  const ins = dataIns(cfg, ports);
  const en = ins.find(p => /^(en|enable|e|g)$/i.test(p.name));
  const din = need(ins.find(p => p !== en), 'no input');
  const out = need(outsOf(ports).find(o => W(o) === 2 ** W(din)) || outsOf(ports)[0], 'no output');
  need(W(out) === 2 ** W(din), `the output is ${W(out)} bits, a ${W(din)}-to-${2 ** W(din)} decoder needs ${2 ** W(din)}: for a 7-segment or other code table use the custom template`);
  const one = `${sized(W(out), 1)} << ${din.name}`;
  return { checks: { [out.name]: en ? `${en.name} ? (${one}) : ${sized(W(out), 0)}` : one }, note: `${W(din)}-to-${W(out)} decoder`,
    reqText: `${out.name} shall be one-hot with bit ${din.name} set${en ? `, and all zeros when ${en.name} = 0` : ''}.`,
    bins: Array.from({ length: Math.min(2 ** W(din), 64) }, (_, k) => ({ id: `IN_${k}`, desc: `${din.name} == ${k}`, cond: `${din.name} == ${k}` })) };
}
function twoOperands(cfg, ports) {
  const ins = ordered(dataIns(cfg, ports));
  const a = need(ins.find(p => /^(a|x|in1|op1|a_i|in_a|data_a|da)$/i.test(p.name)) || ins[0], 'no first operand');
  const b = need(ins.find(p => p !== a && /^(b|y|in2|op2|b_i|in_b|data_b|db)$/i.test(p.name)) || ins.find(p => p !== a && W(p) === W(a)), 'no second operand');
  return { a, b, ins };
}
function comparator(cfg, ports) {
  const { a, b } = twoOperands(cfg, ports);
  const sg = /signed/i.test(cfg.dut.top) && !/unsigned/i.test(cfg.dut.top);
  const A = sg ? `$signed(${a.name})` : a.name, B = sg ? `$signed(${b.name})` : b.name;
  const map = { eq: '==', equal: '==', a_eq_b: '==', lt: '<', less: '<', a_lt_b: '<', gt: '>', greater: '>', a_gt_b: '>', ne: '!=', neq: '!=', le: '<=', ge: '>=' };
  const checks = {};
  for (const o of outsOf(ports)) { const op = map[o.name.toLowerCase()]; if (op) checks[o.name] = `${A} ${op} ${B}`; }
  need(Object.keys(checks).length, 'no eq / lt / gt outputs');
  return { checks, note: `${sg ? 'signed' : 'unsigned'} comparator`, reqText: `Each flag shall compare ${a.name} with ${b.name} as ${sg ? 'signed (two\'s complement)' : 'unsigned'} numbers.`,
    bins: [{ id: 'EQUAL', desc: 'a == b', cond: `${a.name} == ${b.name}` }, { id: 'LESS', desc: 'a < b', cond: `${A} < ${B}` }, { id: 'GREATER', desc: 'a > b', cond: `${A} > ${B}` }],
    directed: [{ [a.name]: 0, [b.name]: 0 }, { [a.name]: 1, [b.name]: 0 }, { [a.name]: 0, [b.name]: 1 }] };
}
function subtractor(cfg, ports) {
  const { a, b, ins } = twoOperands(cfg, ports);
  const bin = ins.find(p => /^(bin|borrow_in|bi|b_in)$/i.test(p.name));
  const outs = outsOf(ports);
  const d = need(outs.find(o => /diff|^d$|^y$|result|res|out/i.test(o.name)), 'no difference output');
  const bo = outs.find(o => /borrow|^bout$|^bo$|^b_out$/i.test(o.name));
  const w = W(a), B = bin ? ` - ${bin.name}` : '';
  const checks = { [d.name]: `${a.name} - ${b.name}${B}` };
  if (bo) checks[bo.name] = `(({1'b0, ${a.name}} - {1'b0, ${b.name}}${B}) >> ${w}) & 1'b1`;
  return { checks, note: 'subtractor', reqText: `${d.name} shall be ${a.name} - ${b.name}${bin ? ` - ${bin.name}` : ''} modulo 2^${w}${bo ? `; ${bo.name} shall be 1 when the true result is negative` : ''}.`,
    bins: [{ id: 'BORROW', desc: 'a < b (borrow)', cond: `${a.name} < ${b.name}` }, { id: 'NO_BORROW', desc: 'a >= b', cond: `${a.name} >= ${b.name}` }] };
}
function addSub(cfg, ports) {
  const { a, b, ins } = twoOperands(cfg, ports);
  const m = need(ins.find(p => /^(mode|sub|add_sub|m|op|ctrl|op_sub|addsub)$/i.test(p.name) && W(p) === 1), 'no 1-bit mode input');
  const outs = outsOf(ports), w = W(a);
  const r = need(outs.find(o => /result|res|sum|out|^y$|^s$/i.test(o.name)), 'no result output');
  const c = outs.find(o => /carry|cout|^c$|c_out/i.test(o.name));
  const v = outs.find(o => /overflow|ovf|^v$|of/i.test(o.name));
  const checks = { [r.name]: `${m.name} ? ${a.name} - ${b.name} : ${a.name} + ${b.name}` };
  if (c) checks[c.name] = `${m.name} ? ((({1'b0, ${a.name}} + {1'b0, ~${b.name}} + 1'b1) >> ${w}) & 1'b1) : ((({1'b0, ${a.name}} + {1'b0, ${b.name}}) >> ${w}) & 1'b1)`;
  if (v) checks[v.name] = `${m.name} ? ((${a.name}[${w - 1}] != ${b.name}[${w - 1}]) && ((((${a.name} - ${b.name}) >> ${w - 1}) & 1'b1) != ${a.name}[${w - 1}])) : ((${a.name}[${w - 1}] == ${b.name}[${w - 1}]) && ((((${a.name} + ${b.name}) >> ${w - 1}) & 1'b1) != ${a.name}[${w - 1}]))`;
  return { checks, note: 'adder-subtractor (two\'s-complement: subtract = a + ~b + 1)', reqText: `${r.name} shall be ${a.name} + ${b.name} when ${m.name} = 0 and ${a.name} - ${b.name} when ${m.name} = 1${c ? `; ${c.name} is the carry out of the two's-complement adder` : ''}${v ? `; ${v.name} flags signed overflow` : ''}.`,
    bins: [{ id: 'ADD', desc: 'mode = add', cond: `${m.name} == 0` }, { id: 'SUB', desc: 'mode = subtract', cond: `${m.name} == 1` }] };
}
function multiplier(cfg, ports) {
  const { a, b } = twoOperands(cfg, ports);
  const p = need(outsOf(ports).find(o => /^(p|prod|product|y|out|result|res|m)$/i.test(o.name)) || outsOf(ports)[0], 'no product output');
  const sg = /signed/i.test(cfg.dut.top) && !/unsigned/i.test(cfg.dut.top);
  return { checks: { [p.name]: sg ? `$signed(${a.name}) * $signed(${b.name})` : `${a.name} * ${b.name}` }, note: `${sg ? 'signed' : 'unsigned'} multiplier`,
    reqText: `${p.name} shall be the ${sg ? 'signed' : 'unsigned'} product ${a.name} × ${b.name} (${W(p)} bits).`,
    bins: [{ id: 'ZERO_OPERAND', desc: 'an operand is 0', cond: `${a.name} == 0 || ${b.name} == 0` }, { id: 'MAX_X_MAX', desc: 'both operands all ones', cond: `${a.name} == {${W(a)}{1'b1}} && ${b.name} == {${W(b)}{1'b1}}` }] };
}
function codeConverter(cfg, ports) {
  const n = String(cfg.dut.top).toLowerCase();
  const din = need(dataIns(cfg, ports)[0], 'no input'), out = need(outsOf(ports)[0], 'no output');
  need(/gray|g2b|b2g/.test(n), 'only binary ↔ Gray converters are built in; use the custom template for BCD and other codes');
  const w = W(din);
  if (/gray_?2_?bin|g2b|gray_?to_?bin/.test(n)) {
    const bits = Array.from({ length: w }, (_, j) => w - 1 - j).map(i => `^${din.name}[${w - 1}:${i}]`);
    return { checks: { [out.name]: `{${bits.join(', ')}}` }, note: 'Gray → binary', reqText: `Bit i of ${out.name} shall be the XOR of ${din.name}[${w - 1}:i].` };
  }
  return { checks: { [out.name]: `${din.name} ^ (${din.name} >> 1)` }, note: 'binary → Gray', reqText: `${out.name} shall be ${din.name} XOR (${din.name} >> 1).` };
}
function parity(cfg, ports) {
  const n = String(cfg.dut.top).toLowerCase();
  const ins = dataIns(cfg, ports);
  const pin = ins.find(p => W(p) === 1 && /parity|^p$|par|parity_in|p_in/i.test(p.name));
  const data = need(ins.find(p => p !== pin && W(p) > 1) || ins.find(p => p !== pin), 'no data input');
  const out = need(outsOf(ports)[0], 'no output');
  const odd = /odd/.test(n) || /odd/.test(out.name);
  const red = odd ? '~^' : '^';
  const e = pin ? `${red}{${data.name}, ${pin.name}}` : `${red}${data.name}`;
  return { checks: { [out.name]: e }, note: `${odd ? 'odd' : 'even'} parity ${pin ? 'checker' : 'generator'}`,
    reqText: pin ? `${out.name} shall be 1 when ${data.name} together with ${pin.name} does not have ${odd ? 'odd' : 'even'} parity.` : `${out.name} shall make the total number of ones in {${data.name}, ${out.name}} ${odd ? 'odd' : 'even'}.` };
}

const TEMPLATE_SPECS = {
  gate, mux, demux, comparator, subtractor, add_sub: addSub, multiplier, code_converter: codeConverter, parity,
  encoder: (c, p) => encoderLike(c, p, false), priority_encoder: (c, p) => encoderLike(c, p, true), decoder
};
const LABELS = {
  gate: 'Logic gate (AND/OR/NAND/NOR/XOR/XNOR/NOT/BUF, vector or N-input)', mux: 'Multiplexer (N:1)', demux: 'Demultiplexer (1:N)',
  encoder: 'Encoder (one-hot → binary)', priority_encoder: 'Priority encoder (highest bit wins, valid)', decoder: 'Decoder (binary → one-hot, enable)',
  comparator: 'Comparator (eq / lt / gt, signed or unsigned)', subtractor: 'Subtractor (difference, borrow)', add_sub: 'Adder-subtractor (mode input, carry, overflow)',
  multiplier: 'Multiplier (signed or unsigned)', code_converter: 'Code converter (binary ↔ Gray)', parity: 'Parity generator / checker (even or odd)'
};

/* ================================================================ model */
function exprModel(cfg, ports, spec, prefix) {
  const P = prefix || 'EXP';
  const ins = dataIns(cfg, ports);
  const outs = outsOf(ports);
  const scope = { inputs: Object.fromEntries(ins.map(p => [p.name, W(p)])), outputs: Object.fromEntries(outs.map(p => [p.name, W(p)])), params: {} };
  const checks = [], py = {};
  for (const [name, text] of Object.entries(spec.checks || {})) {
    const o = outs.find(p => p.name === name);
    if (!o) throw new Error(`behavior.checks: '${name}' is not an output of ${cfg.dut.top}`);
    const c = expr.check(text, Object.assign({}, scope, { outWidth: W(o) }));
    if (!c.ok) throw new Error(`behavior.checks.${name}: ${c.errors.join('; ')}`);
    // computed into a variable as wide as the output: the same sizing/sign rules as the RTL's own assignment
    checks.push({ name, exp: 'x_' + name, sv: expr.toSV(c.ast, scope), width: W(o) });
    py[name] = expr.toPy(expr.parse(text), scope, W(o));
  }
  if (!checks.length) throw new Error('no output has an expected value');
  const totalBits = ins.reduce((s, p) => s + W(p), 0);
  const svArgs = v => ins.map(p => sized(W(p), v[p.name] != null ? BigInt.asUintN(W(p), BigInt(v[p.name])) : 0)).join(', ');
  const pyArgs = v => `{${ins.map(p => `${JSON.stringify(p.name)}: ${v[p.name] != null ? BigInt.asUintN(W(p), BigInt(v[p.name])) : 0}`).join(', ')}}`;
  // directed: given vectors, or all zeros / all ones / walking one on each input
  const rnd = spec.random || {};
  const svRand = ins.map(p => (rnd[p.name] ? rnd[p.name].sv : W(p) <= 32 ? `${W(p)}'(rnd())` : `${W(p)}'({rnd(), rnd()})`)).join(', ');
  const pyRand = `{${ins.map(p => `${JSON.stringify(p.name)}: ${rnd[p.name] ? rnd[p.name].py : `rnd.getrandbits(${W(p)})`}`).join(', ')}}`;
  let directed = spec.directed;
  if (!directed) {
    directed = [{}, Object.fromEntries(ins.map(p => [p.name, (1n << BigInt(W(p))) - 1n]))];
    for (const p of ins) for (let k = 0; k < Math.min(W(p), 8); k++) directed.push({ [p.name]: 1n << BigInt(k) });
  }
  const exhaustive = !spec.noExhaustive && totalBits <= 12;
  const smokeV = directed.slice(0, 2), edgeV = directed.slice(2).length ? directed.slice(2) : directed;
  const scen = [
    { id: `SC-${P}-001`, req: `REQ-${P}-01`, test: 'smoke', title: 'Smoke', desc: 'All inputs zero, all inputs one, then 6 random vectors.', stimulus: 'zeros, ones, 6 random', expected: 'every output equals its expected value',
      body: smokeV.map(v => `apply(${svArgs(v)});`).join(' ') + ` repeat (6) apply(${svRand});`, pyBody: smokeV.map(v => `    await apply(chk, dut, ${pyArgs(v)})`).join('\n') + `\n    for _ in range(6):\n        await apply(chk, dut, ${pyRand})` },
    { id: `SC-${P}-004`, req: `REQ-${P}-01`, test: 'boundary', title: 'Directed corners', desc: spec.directed ? 'Every defined input pattern.' : 'A walking one on each input.', stimulus: `${edgeV.length} directed vectors`, expected: 'every output equals its expected value',
      body: edgeV.map(v => `apply(${svArgs(v)});`).join(' '), pyBody: edgeV.map(v => `    await apply(chk, dut, ${pyArgs(v)})`).join('\n') }
  ];
  if (exhaustive) {
    let off = 0; const parts = [], pyParts = [];
    for (const p of ins) { parts.push(`${W(p)}'(k >> ${off})`); pyParts.push(`${JSON.stringify(p.name)}: (k >> ${off}) & ${(1n << BigInt(W(p))) - 1n}`); off += W(p); }
    scen.push({ id: `SC-${P}-002`, req: `REQ-${P}-01`, test: 'exhaustive', title: 'Exhaustive', desc: `All ${2 ** totalBits} input combinations.`, stimulus: 'every input value', expected: 'every output correct for every input',
      body: `for (int k = 0; k < ${2 ** totalBits}; k++) apply(${parts.join(', ')});`, pyBody: `    for k in range(${2 ** totalBits}):\n        await apply(chk, dut, {${pyParts.join(', ')}})` });
  }
  scen.push({ id: `SC-${P}-003`, req: `REQ-${P}-01`, test: 'random', title: 'Seeded random', desc: 'Random inputs, reproducible by seed.', stimulus: 'ITERATIONS random vectors', expected: 'every output equals its expected value',
    body: `repeat (ITERATIONS) apply(${svRand});`, pyBody: `    for _ in range(ITERATIONS):\n        await apply(chk, dut, ${pyRand})` });
  const bins = (spec.bins || []).map(b => {
    const c = expr.check(b.cond, scope);
    if (!c.ok) throw new Error(`coverage bin ${b.id}: ${c.errors.join('; ')}`);
    return { id: `BIN-${P}-${b.id}`, scenario: scen[scen.length - 1].id, desc: b.desc, cond: expr.toSV(c.ast, scope), stimulus: 'random' };
  });
  return {
    seq: false, roles: {}, inputs: ins.map(p => ({ name: p.name, width: W(p) })), outputs: outs.map(p => ({ name: p.name, width: W(p) })),
    decl: checks.map(c => `  logic [${c.width - 1}:0] ${c.exp};`).join('\n'), reset: '', step: checks.map(c => `    ${c.exp} = ${c.sv};`).join('\n'), checks,
    requirements: [{ id: `REQ-${P}-01`, text: spec.reqText || 'Every output shall equal its expected value from dvflow.json → behavior.checks.' }],
    scenarios: scen, bins,
    sva: '',
    expr: { py, note: spec.note || '', checksText: spec.checks }
  };
}

/** custom template whose behavior.checks are written (combinational): run it like the templates above */
function customExprModel(cfg, ports) {
  const b = cfg.behavior || {};
  const checks = Object.fromEntries(Object.entries(b.checks || {}).filter(([, v]) => !/\/\*\s*expected/.test(String(v))));
  return exprModel(cfg, ports, { checks, bins: b.bins_expr || [], reqText: b.spec || undefined, note: 'custom (behavior.checks)' }, 'CUS');
}
const checksWritten = cfg => { const c = (cfg.behavior && cfg.behavior.checks) || {}; const v = Object.values(c); return v.length > 0 && !v.some(x => /\/\*\s*expected/.test(String(x))); };

/** build a template model, with a clear message when the ports cannot be mapped */
function build(id, cfg, ports) {
  try {
    const spec = TEMPLATE_SPECS[id](cfg, ports);
    // dvflow.json → behavior.checks overrides the generated expression for any output (e.g. an LSB-first priority encoder)
    const ov = (cfg.behavior && cfg.behavior.checks) || {};
    for (const [k, v] of Object.entries(ov)) if (!/\/\*\s*expected/.test(String(v))) spec.checks[k] = v;
    return exprModel(cfg, ports, spec, id.toUpperCase().replace(/_/g, '').slice(0, 4));
  } catch (e) {
    if (e instanceof MapError) throw new Error(`template "${id}" cannot map the ports of ${cfg.dut.top}: ${e.message}. Pick another template, or "custom" and write behavior.checks.`);
    throw e;
  }
}

module.exports = { TEMPLATE_SPECS, LABELS, exprModel, customExprModel, checksWritten, build, MapError };

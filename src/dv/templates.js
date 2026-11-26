'use strict';
/*
 * DUT templates -> verification model (reference model, checks, scenarios, bins, SVA).
 * The reference model is written from the approved behaviour spec (cfg.behavior), never from the RTL,
 * so an RTL implementation error is caught by the checker.
 *
 * Model contract (consumed by tbgen):
 *   seq            sequential DUT (needs clock / reset)
 *   inputs         [{name, width}]                 driven by the TB as in_<name>
 *   outputs        [{name, width}]                 DUT outputs (wires with the port name)
 *   decl           SV declarations for model state (m_*) and pre-state (p_*)
 *   reset          SV statements: model state after reset
 *   step           SV statements: update model after one apply() (uses in_*; may save p_*)
 *   checks         [{name, exp}]  compare DUT output <name> with SV expression exp after each step
 *   checkCode      optional SV replacing the generated compares (scoreboard style); call fail_check(sig, exp, act)
 *   endCode        optional SV run at end of test (e.g. missing-transaction check)
 *   requirements   [{id, text}]
 *   scenarios      [{id, req, title, desc, stimulus, expected, test, body}]   body: SV using apply(...)/do_reset()/idle(n)
 *   bins           [{id, scenario, desc, cond, stimulus, unreachable?}]
 *   sva            SV assertion text for simulators with concurrent SVA (Questa/VCS)
 */

const hex = (v, w) => `${w}'h${BigInt(v).toString(16)}`;
const maxOf = w => (1n << BigInt(w)) - 1n;
const pick = (ports, dir, re, width) => ports.find(p => p.dir === dir && re.test(p.name) && (width == null || p.width === width));

function roles(ports, cfg) {
  const r = Object.assign({}, cfg.ports || {});
  const get = (k, dir, re, w) => { if (!r[k]) { const p = pick(ports, dir, re, w); if (p) r[k] = p.name; } };
  return { r, get };
}

const P = (ports, n) => ports.find(p => p.name === n);

/* ====================================================================== adder */
function adder(cfg, ports) {
  const { r, get } = roles(ports, cfg);
  const ins = ports.filter(p => p.dir === 'input' && !/^(clk|clock|rst|reset|rst_n|resetn)$/i.test(p.name));
  get('cin', 'input', /^(cin|ci|c_in|carry_in|carryin)$/i, 1);
  const ops = ins.filter(p => p.name !== r.cin);
  if (!r.a) r.a = (ops.find(p => /^(a|x|in1|op1|in_a|a_i)$/i.test(p.name)) || ops[0] || {}).name;
  if (!r.b) r.b = (ops.find(p => p.name !== r.a && /^(b|y|in2|op2|in_b|b_i)$/i.test(p.name)) || ops.find(p => p.name !== r.a) || {}).name;
  const W = (P(ports, r.a) || {}).width || cfg.behavior.width || 4;
  get('sum', 'output', /^(sum|s|y|out|result|res|sum_o)$/i, W);
  if (!r.sum) r.sum = (ports.find(p => p.dir === 'output' && p.width === W) || ports.find(p => p.dir === 'output' && p.width === W + 1) || {}).name;
  get('cout', 'output', /^(cout|co|c_out|carry|carry_out|carryout)$/i, 1);
  get('ovf', 'output', /^(ovf|overflow|v|of)$/i, 1);
  const sumW = (P(ports, r.sum) || {}).width || W;
  const wide = sumW === W + 1;               // carry folded into a wider sum
  const MAX = maxOf(W);
  const hasCin = !!r.cin, hasCout = !!r.cout || wide, hasOvf = !!r.ovf;
  const cin = hasCin ? 'in_' + r.cin : "1'b0";
  const inputs = [{ name: r.a, width: W }, { name: r.b, width: W }].concat(hasCin ? [{ name: r.cin, width: 1 }] : []);
  const applyArgs = (a, b, c) => [a, b].concat(hasCin ? [c] : []).join(', ');
  const exhaustiveOk = W <= 8;
  const checks = [{ name: r.sum, exp: wide ? 'm_full' : `m_full[${W - 1}:0]` }];
  if (r.cout) checks.push({ name: r.cout, exp: `m_full[${W}]` });
  if (hasOvf) checks.push({ name: r.ovf, exp: `(in_${r.a}[${W - 1}] == in_${r.b}[${W - 1}]) && (m_full[${W - 1}] != in_${r.a}[${W - 1}])` });
  const reqs = [
    { id: 'REQ-ADD-01', text: `${r.sum} shall equal ${r.a} + ${r.b}${hasCin ? ' + ' + r.cin : ''} modulo 2^${W}${wide ? ' (with the carry in the MSB)' : ''}.` },
    { id: 'REQ-ADD-02', text: hasCout ? `The carry-out shall be 1 exactly when the true sum exceeds ${MAX}.` : 'The interface exposes no carry-out; the sum shall wrap modulo 2^W.' },
    { id: 'REQ-ADD-03', text: 'Zero operands shall produce the other operand unchanged.' },
    { id: 'REQ-ADD-04', text: `Maximum operands (${MAX}) shall produce the correct wrapped sum${hasCout ? ' and carry' : ''}.` }
  ];
  if (hasCin) reqs.push({ id: 'REQ-ADD-05', text: `${r.cin} shall add one to the sum.` });
  if (hasOvf) reqs.push({ id: 'REQ-ADD-06', text: `${r.ovf} shall flag signed two's-complement overflow.` });
  const H = v => hex(v, W);
  const sc = [
    { id: 'SC-ADD-001', req: 'REQ-ADD-01', test: 'smoke', title: 'Smoke: small operands', desc: 'Basic additions with small values.', stimulus: `(0,0) (1,1) (2,3) (${H(MAX >> 1n)},1)`, expected: 'sum = a + b', body: [[0, 0, 0], [1, 1, 0], [2, 3, 0]].map(([a, b, c]) => `apply(${applyArgs(H(a), H(b), "1'b" + c)});`).join(' ') + ` apply(${applyArgs(H(MAX >> 1n), H(1), "1'b0")});` },
    { id: 'SC-ADD-002', req: 'REQ-ADD-03', test: 'boundary', title: 'Zero operands', desc: 'Either or both operands zero.', stimulus: `(0,0) (0,${H(MAX)}) (${H(MAX)},0) (0,5)`, expected: 'sum = the non-zero operand; no carry', body: `apply(${applyArgs(H(0), H(0), "1'b0")}); apply(${applyArgs(H(0), H(MAX), "1'b0")}); apply(${applyArgs(H(MAX), H(0), "1'b0")}); apply(${applyArgs(H(0), H(5n & MAX), "1'b0")});` },
    { id: 'SC-ADD-003', req: 'REQ-ADD-04', test: 'boundary', title: 'Maximum operands / carry-out', desc: 'Maximum operands and the carry boundary.', stimulus: `(${H(MAX)},${H(MAX)}) (${H(MAX)},1) (${H(MAX >> 1n)},${H((MAX >> 1n) + 1n)})`, expected: hasCout ? 'wrapped sum with carry = 1' : 'sum wraps modulo 2^W', body: `apply(${applyArgs(H(MAX), H(MAX), "1'b0")}); apply(${applyArgs(H(MAX), H(1), "1'b0")}); apply(${applyArgs(H(MAX >> 1n), H((MAX >> 1n) + 1n), "1'b0")}); apply(${applyArgs(H(MAX >> 1n), H(1), "1'b0")});` }
  ];
  if (hasCin) sc.push({ id: 'SC-ADD-004', req: 'REQ-ADD-05', test: 'boundary', title: 'Carry-in', desc: 'Carry-in with zero and maximum operands.', stimulus: `(0,0,1) (${H(MAX)},0,1) (${H(MAX)},${H(MAX)},1)`, expected: 'sum = a + b + 1', body: `apply(${applyArgs(H(0), H(0), "1'b1")}); apply(${applyArgs(H(MAX), H(0), "1'b1")}); apply(${applyArgs(H(MAX), H(MAX), "1'b1")});` });
  if (exhaustiveOk) sc.push({ id: 'SC-ADD-005', req: 'REQ-ADD-01', test: 'exhaustive', title: 'Exhaustive', desc: `All ${(1n << BigInt(2 * W + (hasCin ? 1 : 0))).toString()} operand combinations (W=${W}).`, stimulus: 'every a x every b' + (hasCin ? ' x cin' : ''), expected: 'sum (and carry) correct for every combination', body: `for (int ia = 0; ia <= ${MAX}; ia++) for (int ib = 0; ib <= ${MAX}; ib++) ${hasCin ? 'for (int ic = 0; ic < 2; ic++) ' : ''}apply(${applyArgs(`${W}'(ia)`, `${W}'(ib)`, hasCin ? "1'(ic)" : "1'b0")});` });
  sc.push({ id: 'SC-ADD-006', req: 'REQ-ADD-01', test: 'random', title: 'Seeded random', desc: 'Uniform random operands, reproducible by seed.', stimulus: 'ITERATIONS random (a, b' + (hasCin ? ', cin' : '') + ')', expected: 'sum (and carry) correct', body: `repeat (ITERATIONS) apply(${applyArgs(`${W}'(rnd())`, `${W}'(rnd())`, "1'(rnd())")});` });
  const bins = [
    { id: 'BIN-ADD-ZERO_ZERO', scenario: 'SC-ADD-002', desc: 'a == 0 && b == 0', cond: `in_${r.a} == 0 && in_${r.b} == 0`, stimulus: `apply(a=0, b=0)` },
    { id: 'BIN-ADD-MAX_MAX', scenario: 'SC-ADD-003', desc: `a == b == ${MAX}`, cond: `in_${r.a} == ${H(MAX)} && in_${r.b} == ${H(MAX)}`, stimulus: `apply(a=${H(MAX)}, b=${H(MAX)})` },
    { id: 'BIN-ADD-CARRY_OUT', scenario: 'SC-ADD-003', desc: 'true sum > MAX (carry out)', cond: `m_full[${W}] == 1'b1`, stimulus: `apply(a=${H(MAX)}, b=1)` },
    { id: 'BIN-ADD-NO_CARRY', scenario: 'SC-ADD-001', desc: 'true sum <= MAX', cond: `m_full[${W}] == 1'b0`, stimulus: 'apply(a=1, b=1)' },
    { id: 'BIN-ADD-WRAP_TO_ZERO', scenario: 'SC-ADD-003', desc: 'sum wraps to exactly zero', cond: `m_full[${W - 1}:0] == 0 && m_full[${W}] == 1'b1`, stimulus: `apply(a=${H(MAX)}, b=1)` }
  ];
  if (hasCin) bins.push({ id: 'BIN-ADD-CIN_SET', scenario: 'SC-ADD-004', desc: 'carry-in = 1', cond: `${cin} == 1'b1`, stimulus: 'apply(a=0, b=0, cin=1)' });
  if (hasOvf) bins.push({ id: 'BIN-ADD-SIGNED_OVF', scenario: 'SC-ADD-003', desc: 'signed overflow', cond: `(in_${r.a}[${W - 1}] == in_${r.b}[${W - 1}]) && (m_full[${W - 1}] != in_${r.a}[${W - 1}])`, stimulus: `apply(a=${H(MAX >> 1n)}, b=1)` });
  return {
    seq: false, roles: r, width: W, inputs, outputs: ports.filter(p => p.dir === 'output').map(p => ({ name: p.name, width: p.width })),
    decl: `  logic [${W}:0] m_full;`, reset: '', step: `    m_full = {1'b0, in_${r.a}} + {1'b0, in_${r.b}} + ${hasCin ? `{${W}'d0, ${cin}}` : "0"};`,
    checks, requirements: reqs, scenarios: sc, bins,
    sva: `  // combinational: result must be stable and known whenever operands are known\n  a_known: assert property (@(posedge clk) !$isunknown({${r.a}, ${r.b}}) |-> !$isunknown(${r.sum}));`
  };
}

/* ====================================================================== counters 0..N (+ up/down) */
function counter(cfg, ports, updown) {
  const { r, get } = roles(ports, cfg);
  const b = cfg.behavior;
  get('en', 'input', /^(en|enable|ce|cnt_en|count_en|inc)$/i, 1);
  get('up', 'input', /^(up|dir|up_dn|updown|up_down)$/i, 1);
  get('load', 'input', /^(load|ld|set)$/i, 1);
  get('count', 'output', /^(count|cnt|q|value|count_o|out)$/i);
  get('tc', 'output', /^(tc|done|terminal|max|at_max|wrap|full|rollover)$/i, 1);
  get('zero', 'output', /^(zero|at_min|min|empty)$/i, 1);
  const cw = (P(ports, r.count) || {}).width || 4;
  if (!r.d && r.load) { const d = ports.find(p => p.dir === 'input' && p.width === cw && p.name !== r.count); if (d) r.d = d.name; }
  const N = b.N != null ? Number(b.N) : Number(maxOf(cw));
  const MIN = 0;
  const wrap = (b.mode || 'wrap') === 'wrap';
  const hasEn = !!r.en, hasUp = updown && !!r.up, hasLoad = !!r.load && !!r.d;
  const en = hasEn ? 'in_' + r.en : "1'b1";
  const up = hasUp ? 'in_' + r.up : "1'b1";
  const H = v => `${cw}'d${v}`;
  const inputs = [].concat(hasEn ? [{ name: r.en, width: 1 }] : [], hasUp ? [{ name: r.up, width: 1 }] : [], hasLoad ? [{ name: r.load, width: 1 }, { name: r.d, width: cw }] : []);
  const A = o => inputs.map(i => (o[i.name] != null ? o[i.name] : `${i.width}'d0`)).join(', ') || '';
  const E = (o = {}) => { const x = {}; if (hasEn) x[r.en] = "1'b1"; if (hasUp) x[r.up] = "1'b1"; return A(Object.assign(x, o)); };
  const upStep = `(m_count == ${H(N)}) ? ${wrap ? H(0) : H(N)} : m_count + 1'b1`;
  const dnStep = `(m_count == ${H(MIN)}) ? ${wrap ? H(N) : H(MIN)} : m_count - 1'b1`;
  const step = `    p_count = m_count;
${hasLoad ? `    if (in_${r.load}) m_count = in_${r.d};\n    else ` : '    '}if (${en}) m_count = ${updown ? `${up} ? (${upStep}) : (${dnStep})` : `(${upStep})`};`;
  const checks = [{ name: r.count, exp: 'm_count' }];
  if (r.tc) checks.push({ name: r.tc, exp: `(m_count == ${H(N)})` });
  if (r.zero) checks.push({ name: r.zero, exp: `(m_count == ${H(0)})` });
  const reqs = [
    { id: 'REQ-CNT-01', text: `After reset the counter shall be 0.` },
    { id: 'REQ-CNT-02', text: updown ? `When enabled the counter shall count up (${r.up || 'up'}=1) or down (0).` : `When enabled the counter shall increment by one per ${cfg.clock.edge} edge, from 0 through ${N} inclusive.` },
    { id: 'REQ-CNT-03', text: hasEn ? `When ${r.en} is 0 the counter shall hold its value.` : 'The counter counts on every clock (no enable).' },
    { id: 'REQ-CNT-04', text: `At ${N} the counter shall ${wrap ? 'wrap to 0' : 'saturate at ' + N} on the next enabled count${r.tc ? `, and ${r.tc} shall be 1 while the count is ${N}` : ''}.` }
  ];
  if (updown) reqs.push({ id: 'REQ-CNT-05', text: `At 0, counting down shall ${wrap ? 'wrap to ' + N : 'saturate at 0'}; direction changes shall take effect on the next edge.` });
  if (hasLoad) reqs.push({ id: 'REQ-CNT-06', text: `${r.load} shall load ${r.d} and take priority over counting.` });
  const sc = [
    { id: 'SC-CNT-001', req: 'REQ-CNT-01', test: 'reset', title: 'Reset value', desc: 'Apply reset, check the count is 0.', stimulus: 'do_reset(); one idle cycle', expected: 'count == 0', body: `do_reset(); apply(${A({})});` },
    { id: 'SC-CNT-002', req: 'REQ-CNT-02', test: 'smoke', title: 'Count up', desc: 'Count from 0 for min(N, 8) cycles.', stimulus: `do_reset(); ${Math.min(N, 8)} enabled cycles`, expected: 'count increments by one per edge', body: `do_reset(); repeat (${Math.max(1, Math.min(N, 8))}) apply(${E()});` }
  ];
  if (hasEn) sc.push({ id: 'SC-CNT-003', req: 'REQ-CNT-03', test: 'smoke', title: 'Hold when disabled', desc: 'Count to a mid value, then disable for several cycles.', stimulus: `${Math.ceil(N / 2)} enabled, then 4 disabled cycles`, expected: 'count holds', body: `do_reset(); repeat (${Math.max(1, Math.ceil(N / 2))}) apply(${E()}); repeat (4) apply(${A({})});` });
  sc.push({ id: 'SC-CNT-004', req: 'REQ-CNT-04', test: 'boundary', title: 'Terminal count', desc: `Count from 0 to ${N}.`, stimulus: `do_reset(); ${N} enabled cycles`, expected: `count reaches ${N}${r.tc ? ', ' + r.tc + ' = 1' : ''}`, body: `do_reset(); repeat (${N}) apply(${E()}); apply(${A({})});` });
  sc.push({ id: 'SC-CNT-005', req: 'REQ-CNT-04', test: 'boundary', title: wrap ? 'Wrap at N' : 'Saturate at N', desc: `Count past ${N}.`, stimulus: `do_reset(); ${N + 3} enabled cycles`, expected: wrap ? `count goes ${N} -> 0` : `count stays at ${N}`, body: `do_reset(); repeat (${N + 3}) apply(${E()});` });
  if (updown) {
    sc.push({ id: 'SC-CNT-006', req: 'REQ-CNT-05', test: 'boundary', title: wrap ? 'Wrap below 0' : 'Saturate at 0', desc: 'Count down from 0.', stimulus: 'do_reset(); 3 down-count cycles', expected: wrap ? `0 -> ${N}` : 'stays 0', body: `do_reset(); repeat (3) apply(${E({ [r.up]: "1'b0" })});` });
    sc.push({ id: 'SC-CNT-007', req: 'REQ-CNT-05', test: 'smoke', title: 'Direction change', desc: 'Up 3, down 2, up 1.', stimulus: 'U U U D D U', expected: 'count follows direction each edge', body: `do_reset(); repeat (3) apply(${E()}); repeat (2) apply(${E({ [r.up]: "1'b0" })}); apply(${E()});` });
  }
  if (hasLoad) sc.push({ id: 'SC-CNT-008', req: 'REQ-CNT-06', test: 'boundary', title: 'Load priority', desc: `Load ${N} and 0 while enabled.`, stimulus: `load=1, d=${N}, en=1; then load 0`, expected: 'load wins over counting', body: `do_reset(); apply(${E({ [r.load]: "1'b1", [r.d]: H(N) })}); apply(${E()}); apply(${E({ [r.load]: "1'b1", [r.d]: H(0) })});` });
  sc.push({ id: 'SC-CNT-009', req: 'REQ-CNT-01', test: 'reset', title: 'Reset during count', desc: 'Count, reset mid-way, count again.', stimulus: `${Math.max(1, Math.ceil(N / 2))} enabled, do_reset(), 2 enabled`, expected: 'count returns to 0 and resumes', body: `do_reset(); repeat (${Math.max(1, Math.ceil(N / 2))}) apply(${E()}); do_reset(); repeat (2) apply(${E()});` });
  sc.push({ id: 'SC-CNT-010', req: 'REQ-CNT-02', test: 'random', title: 'Seeded random controls', desc: 'Random enable' + (updown ? '/direction' : '') + (hasLoad ? '/load' : '') + '.', stimulus: 'ITERATIONS random cycles', expected: 'count always equals the model', body: `do_reset(); repeat (ITERATIONS) apply(${inputs.map(i => i.name === r.load ? "1'((rnd() & 15) == 0)" : `${i.width}'(rnd())`).join(', ')});` });
  const bins = [];
  if (N <= 16) for (let v = 0; v <= N; v++) bins.push({ id: `BIN-CNT-VAL_${v}`, scenario: v === N ? 'SC-CNT-004' : 'SC-CNT-002', desc: `count == ${v}`, cond: `m_count == ${H(v)}`, stimulus: `${v} enabled cycles after reset` });
  else bins.push({ id: 'BIN-CNT-VAL_0', scenario: 'SC-CNT-001', desc: 'count == 0', cond: `m_count == ${H(0)}`, stimulus: 'reset' }, { id: 'BIN-CNT-VAL_MID', scenario: 'SC-CNT-002', desc: 'count in (0, N)', cond: `m_count > 0 && m_count < ${H(N)}`, stimulus: 'a few enabled cycles' }, { id: 'BIN-CNT-VAL_N', scenario: 'SC-CNT-004', desc: `count == ${N}`, cond: `m_count == ${H(N)}`, stimulus: `${N} enabled cycles` });
  bins.push({ id: wrap ? 'BIN-CNT-WRAP' : 'BIN-CNT-SATURATE', scenario: 'SC-CNT-005', desc: wrap ? `${N} -> 0 on an enabled count` : `held at ${N} on an enabled count`, cond: `p_count == ${H(N)} && ${en}${hasLoad ? ` && !in_${r.load}` : ''}${updown ? ` && ${up}` : ''}`, stimulus: `${N + 1} enabled cycles after reset` });
  if (hasEn) bins.push({ id: 'BIN-CNT-HOLD', scenario: 'SC-CNT-003', desc: 'disabled with a non-zero count', cond: `!${en} && p_count != 0${hasLoad ? ` && !in_${r.load}` : ''}`, stimulus: 'enable a few cycles, then en=0' });
  bins.push({ id: 'BIN-CNT-RESET_MID', scenario: 'SC-CNT-009', desc: 'reset while count != 0', cond: 'reset_mid_hit', stimulus: 'count up, then do_reset()' });
  if (updown) {
    bins.push({ id: wrap ? 'BIN-CNT-UNDERFLOW_WRAP' : 'BIN-CNT-FLOOR', scenario: 'SC-CNT-006', desc: 'count down at 0', cond: `p_count == ${H(0)} && ${en} && !${up}${hasLoad ? ` && !in_${r.load}` : ''}`, stimulus: 'reset, then en=1 up=0' });
    bins.push({ id: 'BIN-CNT-DIR_CHANGE', scenario: 'SC-CNT-007', desc: 'direction changes between enabled cycles', cond: `${en} && (${up} != p_up)`, stimulus: 'up, up, down' });
  }
  if (hasLoad) bins.push({ id: 'BIN-CNT-LOAD_WHILE_EN', scenario: 'SC-CNT-008', desc: 'load asserted while enabled', cond: `in_${r.load} && ${en}`, stimulus: `load=1 with en=1` });
  const rst = cfg.reset.name;
  return {
    seq: true, roles: r, width: cw, N, inputs, outputs: ports.filter(p => p.dir === 'output').map(p => ({ name: p.name, width: p.width })),
    decl: `  logic [${cw - 1}:0] m_count, p_count;\n  logic p_up = 1'b1;\n  bit reset_mid_hit = 0;`,
    reset: `    m_count = '0; p_count = '0;`,
    preReset: `    reset_mid_hit = (m_count != 0);`,
    step: step,
    postBins: '    reset_mid_hit = 0;' + (updown ? `\n    if (${en}) p_up = ${up};` : ''),
    checks, requirements: reqs, scenarios: sc, bins,
    sva: `  a_reset_zero: assert property (@(${cfg.clock.edge} clk) ${cfg.reset.active_low ? '!' : ''}${rst} |=> ${r.count} == 0);
${hasEn ? `  a_hold: assert property (@(${cfg.clock.edge} clk) disable iff (${cfg.reset.active_low ? '!' : ''}${rst}) !${r.en}${hasLoad ? ` && !${r.load}` : ''} |=> $stable(${r.count}));\n` : ''}  a_${wrap ? 'wrap' : 'saturate'}: assert property (@(${cfg.clock.edge} clk) disable iff (${cfg.reset.active_low ? '!' : ''}${rst}) (${r.count} == ${N}) ${hasEn ? `&& ${r.en} ` : ''}${hasLoad ? `&& !${r.load} ` : ''}${updown ? `&& ${r.up} ` : ''}|=> ${r.count} == ${wrap ? 0 : N});
  a_range: assert property (@(${cfg.clock.edge} clk) ${r.count} <= ${N});   // illegal values above N`
  };
}

/* ====================================================================== DFF / register / latch */
function register(cfg, ports) {
  const { r, get } = roles(ports, cfg);
  const kind = cfg.behavior.kind || 'dff';
  get('en', 'input', /^(en|enable|we|load|ld|g|gate)$/i, 1);
  get('d', 'input', /^(d|din|data|data_in|d_i)$/i);
  get('q', 'output', /^(q|dout|data_out|q_o|out)$/i);
  const W = (P(ports, r.q) || {}).width || 1;
  const hasEn = !!r.en;
  const RV = cfg.behavior.reset_value != null ? cfg.behavior.reset_value : 0;
  const MAX = maxOf(W);
  const H = v => `${W}'h${BigInt(v).toString(16)}`;
  const en = hasEn ? 'in_' + r.en : "1'b1";
  const inputs = [{ name: r.d, width: W }].concat(hasEn ? [{ name: r.en, width: 1 }] : []);
  const A = (d, e) => [d].concat(hasEn ? [e] : []).join(', ');
  const latch = kind === 'latch';
  const hasRst = !!cfg.reset.name && !latch || (latch && !!cfg.reset.name);
  const reqs = [
    { id: 'REQ-REG-01', text: latch ? `While ${r.en} is 1, ${r.q} shall follow ${r.d} (transparent).` : `${r.q} shall capture ${r.d} on each ${cfg.clock.edge} edge${hasEn ? ` when ${r.en} is 1` : ''}.` },
    { id: 'REQ-REG-02', text: hasEn ? `When ${r.en} is 0, ${r.q} shall hold.` : 'The register captures every edge.' }
  ];
  if (hasRst) reqs.push({ id: 'REQ-REG-03', text: `Reset shall force ${r.q} to ${RV} and take priority over the enable.` });
  const sc = [
    { id: 'SC-REG-001', req: 'REQ-REG-01', test: 'smoke', title: latch ? 'Transparency' : 'Edge capture', desc: 'Drive several data values with enable on.', stimulus: `d = 0, ${H(MAX)}, ${H(MAX >> 1n)}, 1 with en=1`, expected: 'q == d after each step', body: ['0', MAX, MAX >> 1n, 1].map(v => `apply(${A(H(v), "1'b1")});`).join(' ') }
  ];
  if (hasEn) sc.push({ id: 'SC-REG-002', req: 'REQ-REG-02', test: 'smoke', title: 'Hold', desc: 'Load a value, then change d with enable off.', stimulus: `load ${H(MAX >> 1n)}, then d=${H(MAX)}/0 with en=0`, expected: 'q keeps the loaded value', body: `apply(${A(H(MAX >> 1n), "1'b1")}); apply(${A(H(MAX), "1'b0")}); apply(${A(H(0), "1'b0")});` });
  if (hasRst) {
    sc.push({ id: 'SC-REG-003', req: 'REQ-REG-03', test: 'reset', title: 'Reset', desc: 'Load a value then reset.', stimulus: `load ${H(MAX)}, do_reset()`, expected: `q == ${RV}`, body: `apply(${A(H(MAX), "1'b1")}); do_reset(); apply(${A(H(0), "1'b0")});` });
    if (hasEn) sc.push({ id: 'SC-REG-004', req: 'REQ-REG-03', test: 'boundary', title: 'Reset over enable', desc: 'Assert reset while en=1 and d=MAX.', stimulus: `en=1, d=${H(MAX)}, reset asserted`, expected: `q == ${RV} (reset wins)`, body: `apply(${A(H(MAX), "1'b1")}); drive(${A(H(MAX), "1'b1")}); do_reset(); apply(${A(H(0), "1'b0")});` });
  }
  sc.push({ id: 'SC-REG-005', req: 'REQ-REG-01', test: 'random', title: 'Seeded random', desc: 'Random data / enable.', stimulus: 'ITERATIONS random steps', expected: 'q equals the model', body: `repeat (ITERATIONS) apply(${A(`${W}'(rnd())`, "1'(rnd())")});` });
  const bins = [
    { id: 'BIN-REG-CAPTURE_CHANGE', scenario: 'SC-REG-001', desc: 'enabled with d != previous q', cond: `${en} && in_${r.d} != p_q`, stimulus: 'en=1 with new data' },
    { id: 'BIN-REG-D_ZERO', scenario: 'SC-REG-001', desc: 'd == 0 captured', cond: `${en} && in_${r.d} == 0`, stimulus: 'd=0, en=1' },
    { id: 'BIN-REG-D_MAX', scenario: 'SC-REG-001', desc: `d == ${MAX} captured`, cond: `${en} && in_${r.d} == ${H(MAX)}`, stimulus: `d=${H(MAX)}, en=1` }
  ];
  if (hasEn) bins.push({ id: 'BIN-REG-HOLD_CHANGE', scenario: 'SC-REG-002', desc: 'disabled while d differs from q', cond: `!${en} && in_${r.d} != p_q`, stimulus: 'en=0 with d != q' });
  if (hasRst && hasEn) bins.push({ id: 'BIN-REG-RESET_WITH_EN', scenario: 'SC-REG-004', desc: 'reset asserted while en=1', cond: 'reset_with_en_hit', stimulus: 'drive en=1, then do_reset()' });
  return {
    seq: !latch, latch, roles: r, width: W, inputs, outputs: ports.filter(p => p.dir === 'output').map(p => ({ name: p.name, width: p.width })),
    decl: `  logic [${W - 1}:0] m_q, p_q;\n  bit reset_with_en_hit = 0;\n  bit m_known = ${cfg.reset.name ? 1 : 0};   // without a reset, q is unknown until first loaded`,
    reset: cfg.reset.name ? `    m_q = ${H(RV)}; p_q = ${H(RV)}; m_known = 1;` : '',
    preReset: hasEn ? `    reset_with_en_hit = in_${r.en};` : '',
    step: `    p_q = m_q;\n    if (${en}) begin m_q = in_${r.d}; m_known = 1; end`,
    postBins: '    reset_with_en_hit = 0;',
    checks: [{ name: r.q, exp: 'm_q', guard: 'm_known' }], requirements: reqs, scenarios: sc, bins,
    sva: latch ? `  a_transparent: assert property (@(posedge clk) ${r.en} |-> ${r.q} == ${r.d});` : `${hasEn ? `  a_hold: assert property (@(${cfg.clock.edge} clk) disable iff (${cfg.reset.active_low ? '!' : ''}${cfg.reset.name}) !${r.en} |=> $stable(${r.q}));\n` : ''}  a_capture: assert property (@(${cfg.clock.edge} clk) disable iff (${cfg.reset.active_low ? '!' : ''}${cfg.reset.name}) ${hasEn ? r.en : '1'} |=> ${r.q} == $past(${r.d}));`
  };
}

/* ====================================================================== shift register */
function shift(cfg, ports) {
  const { r, get } = roles(ports, cfg);
  get('sin', 'input', /^(sin|si|serial_in|din|d|data_in)$/i, 1);
  get('dir', 'input', /^(dir|left|lr|right|direction)$/i, 1);
  get('load', 'input', /^(load|ld|pload)$/i, 1);
  get('en', 'input', /^(en|enable|shift|shift_en|ce)$/i, 1);
  get('q', 'output', /^(q|pout|dout|data_out|par_out|out)$/i);
  get('sout', 'output', /^(sout|so|serial_out|msb|lsb)$/i, 1);
  const W = (P(ports, r.q) || {}).width || 4;
  if (!r.d && r.load) { const d = ports.find(p => p.dir === 'input' && p.width === W); if (d) r.d = d.name; }
  const defDir = (cfg.behavior.direction || 'left');
  const hasDir = !!r.dir, hasLoad = !!r.load && !!r.d, hasEn = !!r.en;
  const left = hasDir ? (cfg.behavior.dir_left_value === 0 ? `!in_${r.dir}` : `in_${r.dir}`) : (defDir === 'left' ? "1'b1" : "1'b0");
  const en = hasEn ? 'in_' + r.en : "1'b1";
  const inputs = [{ name: r.sin, width: 1 }].concat(hasDir ? [{ name: r.dir, width: 1 }] : [], hasEn ? [{ name: r.en, width: 1 }] : [], hasLoad ? [{ name: r.load, width: 1 }, { name: r.d, width: W }] : []);
  const A = o => inputs.map(i => (o[i.name] != null ? o[i.name] : (i.name === r.en ? "1'b1" : `${i.width}'d0`))).join(', ');
  const H = v => `${W}'h${BigInt(v).toString(16)}`;
  const leftVal = cfg.behavior.dir_left_value === 0 ? "1'b0" : "1'b1";
  const rightVal = cfg.behavior.dir_left_value === 0 ? "1'b1" : "1'b0";
  const checks = [{ name: r.q, exp: 'm_q' }];
  if (r.sout) checks.push({ name: r.sout, exp: `(${left}) ? m_q[${W - 1}] : m_q[0]` });
  const reqs = [
    { id: 'REQ-SR-01', text: `Each ${cfg.clock.edge} edge${hasEn ? ` with ${r.en}=1` : ''} shall shift ${r.sin} into the register (${hasDir ? 'direction from ' + r.dir : defDir}).` },
    { id: 'REQ-SR-02', text: 'After reset the register shall be all zeros.' }
  ];
  if (hasLoad) reqs.push({ id: 'REQ-SR-03', text: `${r.load} shall load ${r.d} in parallel and take priority over shifting.` });
  if (hasDir) reqs.push({ id: 'REQ-SR-04', text: 'Changing direction shall take effect on the next edge.' });
  const sc = [
    { id: 'SC-SR-001', req: 'REQ-SR-01', test: 'smoke', title: 'Serial shift of ones', desc: `Shift ${W} ones in, then ${W} zeros.`, stimulus: `${W} x sin=1, ${W} x sin=0`, expected: 'register fills with ones then empties', body: `do_reset(); repeat (${W}) apply(${A({ [r.sin]: "1'b1" })}); repeat (${W}) apply(${A({ [r.sin]: "1'b0" })});` },
    { id: 'SC-SR-002', req: 'REQ-SR-02', test: 'reset', title: 'Reset', desc: 'Fill with ones then reset.', stimulus: 'shift ones, do_reset()', expected: 'all zeros', body: `do_reset(); repeat (${W}) apply(${A({ [r.sin]: "1'b1" })}); do_reset(); apply(${A({})});` }
  ];
  if (hasLoad) sc.push({ id: 'SC-SR-003', req: 'REQ-SR-03', test: 'boundary', title: 'Parallel load priority', desc: 'Load a pattern while shift is requested, then shift it out.', stimulus: `load ${H(0xA5n & maxOf(W))} with sin=1, then ${W} shifts`, expected: 'load wins; pattern shifts out', body: `do_reset(); apply(${A({ [r.load]: "1'b1", [r.d]: H(0xA5n & maxOf(W)), [r.sin]: "1'b1" })}); repeat (${W}) apply(${A({})});` });
  if (hasDir) sc.push({ id: 'SC-SR-004', req: 'REQ-SR-04', test: 'boundary', title: 'Direction change', desc: 'Shift left twice then right twice.', stimulus: 'L L R R with sin=1', expected: 'bits move according to direction', body: `do_reset(); repeat (2) apply(${A({ [r.sin]: "1'b1", [r.dir]: leftVal })}); repeat (2) apply(${A({ [r.sin]: "1'b1", [r.dir]: rightVal })});` });
  if (hasEn) sc.push({ id: 'SC-SR-005', req: 'REQ-SR-01', test: 'smoke', title: 'Hold when disabled', desc: 'Shift twice, disable twice.', stimulus: 'en=1 x2, en=0 x2', expected: 'register holds while disabled', body: `do_reset(); repeat (2) apply(${A({ [r.sin]: "1'b1" })}); repeat (2) apply(${A({ [r.sin]: "1'b1", [r.en]: "1'b0" })});` });
  sc.push({ id: 'SC-SR-006', req: 'REQ-SR-01', test: 'random', title: 'Seeded random', desc: 'Random controls and serial data.', stimulus: 'ITERATIONS random cycles', expected: 'register equals the model', body: `do_reset(); repeat (ITERATIONS) apply(${inputs.map(i => i.name === r.load ? "1'((rnd() & 7) == 0)" : `${i.width}'(rnd())`).join(', ')});` });
  const bins = [
    { id: 'BIN-SR-ALL_ONES', scenario: 'SC-SR-001', desc: 'register full of ones', cond: `m_q == ${H(maxOf(W))}`, stimulus: `${W} shifts of sin=1` },
    { id: 'BIN-SR-SHIFT_IN_0', scenario: 'SC-SR-001', desc: 'shift a 0 into a non-zero register', cond: `${en} && !in_${r.sin} && p_q != 0${hasLoad ? ` && !in_${r.load}` : ''}`, stimulus: 'fill, then sin=0' }
  ];
  if (hasLoad) bins.push({ id: 'BIN-SR-LOAD_OVER_SHIFT', scenario: 'SC-SR-003', desc: 'load while shift requested', cond: `in_${r.load} && ${en}`, stimulus: 'load=1 with en=1' });
  if (hasDir) bins.push({ id: 'BIN-SR-DIR_LEFT', scenario: 'SC-SR-004', desc: 'shift left', cond: `${en} && (${left})`, stimulus: 'dir=left' }, { id: 'BIN-SR-DIR_RIGHT', scenario: 'SC-SR-004', desc: 'shift right', cond: `${en} && !(${left})`, stimulus: 'dir=right' });
  return {
    seq: true, roles: r, width: W, inputs, outputs: ports.filter(p => p.dir === 'output').map(p => ({ name: p.name, width: p.width })),
    decl: `  logic [${W - 1}:0] m_q, p_q;`,
    reset: `    m_q = '0; p_q = '0;`,
    step: `    p_q = m_q;\n${hasLoad ? `    if (in_${r.load}) m_q = in_${r.d};\n    else ` : '    '}if (${en}) m_q = (${left}) ? {m_q[${W - 2}:0], in_${r.sin}} : {in_${r.sin}, m_q[${W - 1}:1]};`,
    checks, requirements: reqs, scenarios: sc, bins,
    sva: `  a_shift: assert property (@(${cfg.clock.edge} clk) disable iff (${cfg.reset.active_low ? '!' : ''}${cfg.reset.name}) ${hasEn ? r.en : '1'}${hasLoad ? ` && !${r.load}` : ''}${hasDir ? '' : ''} |=> ${r.q}[${defDir === 'left' && !hasDir ? 0 : W - 1}] == $past(${r.sin}) || ${hasDir ? '1' : '0'});`
  };
}

/* ====================================================================== valid/data pipeline (scoreboard + missing-transaction check) */
function pipeline(cfg, ports) {
  const { r, get } = roles(ports, cfg);
  get('in_valid', 'input', /^(in_valid|valid_in|vld_in|i_valid|valid_i|in_vld)$/i, 1);
  get('in_data', 'input', /^(in_data|data_in|din|i_data|data_i)$/i);
  get('out_valid', 'output', /^(out_valid|valid_out|vld_out|o_valid|valid_o)$/i, 1);
  get('out_data', 'output', /^(out_data|data_out|dout|o_data|data_o)$/i);
  const W = (P(ports, r.in_data) || {}).width || 8;
  const L = Number(cfg.behavior.latency || 1);
  const xf = cfg.behavior.transform || `in_${r.in_data}`;      // expected output data as a function of the input
  const inputs = [{ name: r.in_valid, width: 1 }, { name: r.in_data, width: W }];
  const sc = [
    { id: 'SC-PIPE-001', req: 'REQ-PIPE-01', test: 'smoke', title: 'Single transactions', desc: 'Isolated valid beats with idle gaps.', stimulus: '4 beats, each followed by 3 idle cycles', expected: `each beat appears after ${L} cycle(s) with the expected data`, body: `do_reset(); for (int k = 0; k < 4; k++) begin apply(1'b1, ${W}'(k * 17 + 1)); repeat (3) apply(1'b0, ${W}'d0); end` },
    { id: 'SC-PIPE-002', req: 'REQ-PIPE-02', test: 'boundary', title: 'Back-to-back transactions', desc: 'Valid on 8 consecutive cycles.', stimulus: '8 consecutive beats', expected: 'no beat dropped or duplicated', body: `do_reset(); for (int k = 0; k < 8; k++) apply(1'b1, ${W}'(k + 1)); repeat (${L + 2}) apply(1'b0, ${W}'d0);` },
    { id: 'SC-PIPE-003', req: 'REQ-PIPE-01', test: 'random', title: 'Seeded random traffic', desc: 'Random valid density and data.', stimulus: 'ITERATIONS random beats', expected: 'output stream equals the input stream', body: `do_reset(); repeat (ITERATIONS) apply(1'(rnd()), ${W}'(rnd())); repeat (${L + 2}) apply(1'b0, ${W}'d0);` }
  ];
  return {
    seq: true, roles: r, width: W, inputs, outputs: ports.filter(p => p.dir === 'output').map(p => ({ name: p.name, width: p.width })),
    decl: `  logic [${W - 1}:0] exp_q [$];\n  int n_out = 0, n_in = 0;\n  bit p_valid = 0;`,
    reset: '    exp_q.delete();',
    step: `    if (in_${r.in_valid}) begin exp_q.push_back(${xf}); n_in++; end`,
    checkCode: `    if (${r.out_valid} === 1'b1) begin
      n_out++;
      if (exp_q.size() == 0) fail_check("${r.out_valid}", 0, 1, "unexpected transaction (nothing outstanding)");
      else begin : sb_compare
        logic [${W - 1}:0] e;
        e = exp_q.pop_front();
        checks++; sc_checks[cur_sc]++;
        if (${r.out_data} !== e) fail_check("${r.out_data}", e, ${r.out_data}, "data mismatch");
      end
    end`,
    endCode: `    repeat (${L + 2}) apply(1'b0, ${W}'d0);
    if (exp_q.size() != 0) begin
      errors++;
      $display("DVFLOW_MISSING t=%0t test=%0s seed=%0d scenario=%0s expected_transactions=%0d received=%0d missing=%0d first_missing_data=%0h", $time, test_name, seed_orig, sc_name(cur_sc), n_in, n_out, exp_q.size(), exp_q[0]);
    end`,
    requirements: [
      { id: 'REQ-PIPE-01', text: `Every input beat (${r.in_valid}=1) shall appear on the output exactly once, ${L} cycle(s) later, in order.` },
      { id: 'REQ-PIPE-02', text: 'Back-to-back beats shall not be dropped or merged.' }
    ],
    scenarios: sc,
    bins: [
      { id: 'BIN-PIPE-BACK_TO_BACK', scenario: 'SC-PIPE-002', desc: 'valid on consecutive cycles', cond: `in_${r.in_valid} && p_valid`, stimulus: 'two consecutive beats' },
      { id: 'BIN-PIPE-GAP', scenario: 'SC-PIPE-001', desc: 'idle cycle after a beat', cond: `!in_${r.in_valid} && p_valid`, stimulus: 'beat then idle' },
      { id: 'BIN-PIPE-DATA_MAX', scenario: 'SC-PIPE-003', desc: 'data == all ones', cond: `in_${r.in_valid} && in_${r.in_data} == '1`, stimulus: `beat with data ${W}'h${maxOf(W).toString(16)}` }
    ],
    postBins: `    p_valid = in_${r.in_valid};`,
    sva: `  a_no_x: assert property (@(posedge clk) disable iff (${cfg.reset.active_low ? '!' : ''}${cfg.reset.name}) !$isunknown(${r.out_valid}));`
  };
}

/* ====================================================================== custom (user-supplied model) */
function custom(cfg, ports) {
  const b = cfg.behavior;
  const clkRst = new Set([cfg.clock && cfg.clock.name, cfg.reset && cfg.reset.name].filter(Boolean));
  const inputs = ports.filter(p => p.dir === 'input' && !clkRst.has(p.name)).map(p => ({ name: p.name, width: p.width || 1 }));
  const checks = Object.entries(b.checks || {}).map(([name, exp]) => ({ name, exp }));
  const A = () => inputs.map(i => `${i.width}'(rnd())`).join(', ');
  return {
    seq: !!b.sequential, roles: {}, inputs, outputs: ports.filter(p => p.dir === 'output').map(p => ({ name: p.name, width: p.width })),
    decl: b.model_decl || '', reset: b.model_reset || '', step: b.model_step || '',
    checks, requirements: (b.requirements || [{ id: 'REQ-CUS-01', text: b.spec || 'Outputs shall match the user-supplied reference model.' }]),
    scenarios: b.scenarios || [
      { id: 'SC-CUS-001', req: 'REQ-CUS-01', test: 'smoke', title: 'Smoke', desc: '8 random steps', stimulus: '8 random input vectors', expected: 'outputs equal the model', body: `${b.sequential ? 'do_reset(); ' : ''}repeat (8) apply(${A()});` },
      { id: 'SC-CUS-002', req: 'REQ-CUS-01', test: 'random', title: 'Seeded random', desc: 'ITERATIONS random steps', stimulus: 'random vectors', expected: 'outputs equal the model', body: `${b.sequential ? 'do_reset(); ' : ''}repeat (ITERATIONS) apply(${A()});` }
    ],
    bins: b.bins || [], sva: b.sva || ''
  };
}

const TEMPLATES = {
  adder: { label: 'Adder (2/4/8-bit or parameterized)', build: adder },
  counter: { label: 'Counter 0..N (wrap or saturate)', build: (c, p) => counter(c, p, false) },
  updown_counter: { label: 'Up/down counter', build: (c, p) => counter(c, p, true) },
  dff: { label: 'D flip-flop / register', build: (c, p) => register(Object.assign({}, c, { behavior: Object.assign({ kind: 'dff' }, c.behavior) }), p) },
  latch: { label: 'Transparent latch', build: (c, p) => register(Object.assign({}, c, { behavior: Object.assign({}, c.behavior, { kind: 'latch' }) }), p) },
  shift_register: { label: 'Shift register', build: shift },
  pipeline: { label: 'Valid/data pipeline (scoreboard)', build: pipeline },
  custom: { label: 'Custom (your reference model)', build: custom }
};

/** guess the template from the module name / ports */
function guess(mod) {
  const n = mod.name.toLowerCase();
  const names = mod.ports.map(p => p.name.toLowerCase());
  if (/add/.test(n) || (names.includes('sum') || names.includes('cout'))) return 'adder';
  if (/shift|sipo|piso|shreg/.test(n)) return 'shift_register';
  if (/latch/.test(n)) return 'latch';
  if (/up_?down|updn|udc/.test(n) || (names.some(x => /^(up|dir)$/.test(x)) && /cnt|count/.test(n))) return 'updown_counter';
  if (/count|cnt/.test(n)) return 'counter';
  if (/pipe|delay|stage|valid/.test(n) || names.some(x => /valid/.test(x))) return 'pipeline';
  if (/dff|flop|reg/.test(n) || names.includes('q')) return 'dff';
  return 'custom';
}

module.exports = { TEMPLATES, guess, maxOf };

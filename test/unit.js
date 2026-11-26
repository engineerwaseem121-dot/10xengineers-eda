'use strict';
/* Unit tests that need no VS Code and no simulator: node test/unit.js (exit code 1 on failure). */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = p => require(path.join(__dirname, '..', p));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message || e)); }
}

console.log('seeds');
const S = R('src/dv/seeds.js');
t('single seed', () => assert.deepStrictEqual(S.parseSeeds('7').seeds, [7]));
t('list', () => assert.deepStrictEqual(S.parseSeeds('1,5,9').seeds, [1, 5, 9]));
t('range is inclusive', () => assert.strictEqual(S.parseSeeds('0:100').seeds.length, 101));
t('stepped range', () => assert.deepStrictEqual(S.parseSeeds('0:20:10').seeds, [0, 10, 20]));
t('random N', () => assert.strictEqual(S.parseSeeds('random 5').seeds.length, 5));
t('mix drops duplicates', () => assert.deepStrictEqual(S.parseSeeds('1,2,1:3').seeds, [1, 2, 3]));
t('descending range is an error', () => assert.ok(S.parseSeeds('5:1').error));
t('zero step is an error', () => assert.ok(S.parseSeeds('0:10:0').error));
t('text is an error', () => assert.ok(S.parseSeeds('abc').error));
t('too many seeds is an error', () => assert.ok(S.parseSeeds('0:200000').error));

console.log('RISC-V disassembler');
const WT = R('media/decoders.js');
const RV = [[0x00000013, 'nop'], [0x00a00513, 'li a0, 10'], [0x00008067, 'ret'], [0xff010113, 'addi sp, sp, -16'], [0x00112623, 'sw ra, 12(sp)'],
  [0x008000ef, 'jal ra, 0x108'], [0x00b50463, 'beq a0, a1, 0x108'], [0x0005a503, 'lw a0, 0(a1)'], [0x02c58533, 'mul a0, a1, a2'],
  [0xf1402573, 'csrrs a0, mhartid, zero'], [0x40b50533, 'sub a0, a0, a1'], [0x4515, 'c.li a0, 5'], [0x1141, 'c.addi sp, -16'],
  [0x8082, 'c.jr ra (ret)'], [0x852e, 'c.mv a0, a1'], [0xc22a, 'c.swsp a0, 4(sp)'], [0x4512, 'c.lwsp a0, 4(sp)'], [0xa011, 'c.j 0x104'], [0xffffffff, 'illegal']];
for (const [w, exp] of RV) t(`${w.toString(16).padStart(8, '0')} -> ${exp}`, () => assert.strictEqual(WT.rvDisasm(w >>> 0, 0x100).text, exp));

console.log('protocol decoders');
t('SPI-Flash frames, opcodes and WREN check', () => {
  const mk = v => ({ t: [0], v: [v] });
  const sclk = mk('0'), mosi = mk('0'), miso = mk('0'), cs = mk('1');
  let now = 10;
  const set = (s, v) => { if (s.v[s.v.length - 1] !== v) { s.t.push(now); s.v.push(v); } };
  const frame = (tx, rx) => {
    set(cs, '0'); now += 5;
    tx.forEach((b, i) => { const r = rx[i] || 0; for (let k = 7; k >= 0; k--) { set(mosi, String((b >> k) & 1)); set(miso, String((r >> k) & 1)); now += 5; set(sclk, '1'); now += 5; set(sclk, '0'); } });
    now += 5; set(cs, '1'); now += 20;
  };
  frame([0x06], []); frame([0x02, 0, 1, 0, 0xde, 0xad], []); frame([0x03, 0, 1, 0, 0, 0], [0, 0, 0, 0, 0xbe, 0xef]); frame([0x20, 0, 0x10, 0], []);
  const tx = WT.DECODERS.spiflash.decode({ sclk, mosi, miso, cs_n: cs }, { cpol: 0, cpha: 0, addrBytes: 3 });
  assert.deepStrictEqual(tx.map(x => x.kind), ['WREN', 'PAGE_PROGRAM', 'READ', 'SECTOR_ERASE_4K']);
  assert.match(tx[1].data, /de ad/); assert.match(tx[2].data, /be ef/);
  assert.ok(!tx[1].error, 'program after WREN is fine'); assert.ok(tx[3].error, 'erase without WREN is flagged');
});
t('RISC-V trace: branch taken / not taken', () => {
  const b = n => n.toString(2).padStart(32, '0');
  const clk = { t: [], v: [] }, pc = { t: [], v: [] }, insn = { t: [], v: [] };
  [[0x100, 0x00b50463], [0x108, 0x00a00513], [0x10c, 0x00b50463], [0x110, 0x00008067]].forEach(([p, i], k) => {
    pc.t.push(k * 10); pc.v.push(b(p)); insn.t.push(k * 10); insn.v.push(b(i)); clk.t.push(k * 10, k * 10 + 5); clk.v.push('0', '1');
  });
  const rv = WT.DECODERS.riscv.decode({ clk, pc, insn }, { edge: 'rising' });
  assert.match(rv[0].info, /taken to 0x00000108/); assert.match(rv[2].info, /not taken/);
});
t('pattern search', () => {
  const sig = { a: { t: [0, 10, 20], v: ['0', '1', '0'] }, b: { t: [0, 15], v: ['0', '1'] } };
  assert.deepStrictEqual(WT.search('a && b', sig, n => n, 10), [15]);
});
t('contrast floor', () => {
  const c = WT.ensureContrast('#facc15', '#ffffff', 3);
  assert.ok(WT.contrast(WT.parseColor(c), [255, 255, 255]) >= 3);
  assert.strictEqual(WT.ensureContrast('#22c55e', '#1e1e1e', 3), '#22c55e');
});

console.log('VCD + X-trace');
const { parseVcd } = R('src/vcd.js');
const rtlx = R('src/rtlx.js');
const { listVars } = R('src/wavetools.js');
const RTL = `module xsub (input logic clk, input logic [7:0] din, output logic [7:0] dout);
  logic [7:0] r;
  always_ff @(posedge clk) r <= din + 8'd1;
  assign dout = r;
endmodule
module xtop (input logic clk, input logic rst_n, input logic [7:0] a, output logic [7:0] y);
  logic [7:0] acc;
  logic [7:0] s;
  always_ff @(posedge clk or negedge rst_n)
    if (!rst_n) acc <= 8'd0;
    else        acc <= s;
  xsub u_sub (.clk(clk), .din(a), .dout(s));
  assign y = acc ^ 8'h5a;
endmodule
module tb;
  logic clk = 0, rst_n = 0;
  logic [7:0] a;
  logic [7:0] y;
  always #5 clk = ~clk;
  xtop dut (.clk(clk), .rst_n(rst_n), .a(a), .y(y));
  initial begin
    $dumpfile("waves.vcd"); $dumpvars(0, tb);
    #12 rst_n = 1;
    #63 a = 8'h03;
  end
endmodule`;
// hand-written dump of the same design: a, s, r, acc, y are X until a becomes 3 at 75
const VCD = `$timescale 1ns $end
$scope module tb $end
$var reg 1 ! clk $end
$var reg 8 " a [7:0] $end
$scope module dut $end
$var wire 8 # a [7:0] $end
$var reg 8 $ acc [7:0] $end
$var wire 8 % s [7:0] $end
$var wire 8 & y [7:0] $end
$scope module u_sub $end
$var wire 8 ' din [7:0] $end
$var wire 8 ( dout [7:0] $end
$var reg 8 ) r [7:0] $end
$upscope $end
$upscope $end
$upscope $end
$enddefinitions $end
#0
0!
bxxxxxxxx "
bxxxxxxxx #
b0 $
bxxxxxxxx %
b1011010 &
bxxxxxxxx '
bxxxxxxxx (
bxxxxxxxx )
#15
bxxxxxxxx $
bxxxxxxxx &
#75
b11 "
b11 #
b11 '
#85
b100 )
b100 (
b100 %
#95
b100 $
b1011110 &
`;
const parsed = parseVcd(VCD);
t('VCD parser: hierarchy and values', () => {
  assert.strictEqual(parsed.meta.endTime, 95);
  assert.deepStrictEqual(listVars(parsed.meta).map(v => v.scope + '.' + v.name.replace(/\s*\[.*$/, '')).sort(),
    ['tb.a', 'tb.clk', 'tb.dut.a', 'tb.dut.acc', 'tb.dut.s', 'tb.dut.u_sub.din', 'tb.dut.u_sub.dout', 'tb.dut.u_sub.r', 'tb.dut.y']);
});
const index = rtlx.buildIndex([{ file: 'x.sv', text: RTL }]);
t('RTL index: modules, drivers, instances (no $system tasks)', () => {
  assert.deepStrictEqual(Object.keys(index).sort(), ['tb', 'xsub', 'xtop']);
  assert.deepStrictEqual(index.tb.instances.map(i => i.name), ['dut']);
  assert.strictEqual(index.xtop.instances[0].ports.din, 'a');
});
t('X-trace walks the hierarchy to the testbench input', () => {
  const r = rtlx.traceX(parsed, listVars(parsed.meta), index, { path: 'tb.dut.y', t: 40 });
  assert.deepStrictEqual(r.steps.map(s => s.path), ['tb.dut.y', 'tb.dut.acc', 'tb.dut.s', 'tb.dut.u_sub.dout', 'tb.dut.u_sub.r', 'tb.dut.u_sub.din', 'tb.dut.a', 'tb.a']);
  assert.match(r.root.reason, /initial blocks/);
});
t('X-trace reports a known value', () => assert.ok(rtlx.traceX(parsed, listVars(parsed.meta), index, { path: 'tb.dut.y', t: 95 }).known));
t('declaration lookup', () => assert.strictEqual(rtlx.findDeclaration(index, 'tb.dut.u_sub', 'r').line, 1));

console.log('test plan Excel');
t('testplan.xlsx is written from testplan.yaml before any run', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tenx-plan-'));
  fs.writeFileSync(path.join(d, 'testplan.yaml'), `plan_version: 1
dut: demo
requirements:
  - id: REQ-1
    text: "it works"
scenarios:
  - id: SC-1
    requirement: REQ-1
    title: "smoke"
    tests: [TEST-smoke]
    status: planned
coverage_bins:
  - id: BIN-1
    scenario: SC-1
    definition: "x"
tests:
  - id: TEST-smoke
    name: smoke
    scenarios: [SC-1]
`);
  const out = R('src/dv/planxlsx.js').writePlan(d);
  assert.ok(out && fs.existsSync(out) && fs.statSync(out).size > 1000);
  assert.strictEqual(fs.readFileSync(out).slice(0, 2).toString(), 'PK');
});

console.log('FIFO template + typographic quotes');
const T = R('src/dv/templates.js'), TB = R('src/dv/tbgen.js');
const fifoPorts = [['clk', 'input', 1], ['rst_n', 'input', 1], ['wr_en', 'input', 1], ['wr_data', 'input', 8], ['wr_ready', 'output', 1], ['rd_en', 'input', 1],
  ['rd_data', 'output', 8], ['rd_valid', 'output', 1], ['full', 'output', 1], ['empty', 'output', 1], ['count', 'output', 4]].map(([name, dir, width]) => ({ name, dir, width }));
const fcfg = { template: 'fifo', behavior: {}, clock: { name: 'clk', edge: 'posedge' }, reset: { name: 'rst_n', active_low: true } };
const fm = T.TEMPLATES.fifo.build(fcfg, fifoPorts, { ADDR_WIDTH: 3 });
t('FIFO detected from the module and ports', () => assert.strictEqual(T.guess({ name: 'fifo_controller', ports: fifoPorts }), 'fifo'));
t('FIFO depth from ADDR_WIDTH', () => assert.strictEqual(fm.depth, 8));
t('FIFO depth from the count width when there is no parameter', () => assert.strictEqual(T.TEMPLATES.fifo.build(fcfg, fifoPorts, {}).depth, 8));
t('FIFO checks every status output', () => assert.deepStrictEqual(fm.checks.map(c => c.name).sort(), ['count', 'empty', 'full', 'rd_data', 'rd_valid', 'wr_ready']));
t('FIFO rd_data is checked only after an accepted read', () => assert.strictEqual(fm.checks.find(c => c.name === 'rd_data').guard, 'm_do_rd'));
t('typographic quotes found with line numbers (comments ignored)', () => { const s = TB.smartChars('a\nrd <= ’0;\n// fine ’ in a comment\n'); assert.strictEqual(s.length, 1); assert.strictEqual(s[0].line, 2); });
t('typographic quotes fixed', () => assert.strictEqual(TB.fixSmartChars('1’b0 “x”'), '1\'b0 "x"'));

console.log('Templates from tutorial-site designs');
const port = (name, dir, width) => ({ name, dir, width });
const ctl = { behavior: {}, clock: { name: 'clk', edge: 'posedge' }, reset: { name: 'rst_n', active_low: true } };
t('memory with wr_en/rd_en is detected as memory, not FIFO', () => assert.strictEqual(T.guess({ name: 'memory', ports: [port('clk', 'input', 1), port('reset', 'input', 1), port('addr', 'input', 2), port('wr_en', 'input', 1), port('rd_en', 'input', 1), port('wdata', 'input', 8), port('rdata', 'output', 8)] }), 'memory'));
t('memory reset value comes from the RESET_VALUE parameter', () => {
  const m = T.TEMPLATES.memory.build(Object.assign({ template: 'memory' }, ctl), [port('clk', 'input', 1), port('addr', 'input', 2), port('wr_en', 'input', 1), port('rd_en', 'input', 1), port('wdata', 'input', 8), port('rdata', 'output', 8)], { RESET_VALUE: 255 });
  assert.strictEqual(m.depth, 4); assert.strictEqual(m.resetClears, true); assert.strictEqual(m.resetValue, 'ff');
});
t('counter terminal count comes from the N parameter', () => {
  const m = T.TEMPLATES.counter.build(Object.assign({ template: 'counter' }, ctl), [port('clk', 'input', 1), port('en', 'input', 1), port('count', 'output', 4), port('tc', 'output', 1)], { N: 9 });
  assert.strictEqual(m.N, 9);
});
t('adder checks a per-stage carry vector', () => {
  const m = T.TEMPLATES.adder.build(Object.assign({ template: 'adder' }, ctl), [port('A', 'input', 4), port('B', 'input', 4), port('Cin', 'input', 1), port('S', 'output', 4), port('Cout', 'output', 4)], {});
  assert.ok(m.checks.some(c => c.name === 'Cout' && c.exp === 'm_cv[4:1]'));
});

console.log('Excel viewer reader');
const XR = R('src/xlsxread.js'), XW = R('src/xlsx.js');
t('round trip: write a workbook, read it back', () => {
  const buf = XW.build([{ name: 'Scenarios', title: 'Plan', columns: [{ header: 'ID' }, { header: 'Hits', type: 'num' }, { header: 'Status' }], rows: [['SC-1', 5, 'PASS'], ['SC-2', 0, 'HOLE & <x>']], statusCol: 2 }]);
  const w = XR.readXlsx(buf);
  assert.strictEqual(w.sheets[0].name, 'Scenarios');
  const rows = w.sheets[0].rows.filter(r => r.length);
  assert.deepStrictEqual(rows[0], ['Plan']);
  assert.deepStrictEqual(rows[1], ['ID', 'Hits', 'Status']);
  assert.deepStrictEqual(rows[2], ['SC-1', 5, 'PASS']);
  assert.deepStrictEqual(rows[3], ['SC-2', 0, 'HOLE & <x>']);
});
t('path links only for files that exist', () => {
  const data = { sheets: [{ rows: [['C:\\exists.txt', 'C:\\missing.txt', 'not a path']] }] };
  assert.deepStrictEqual(XR.pathLinks(data, p => p === 'C:\\exists.txt'), { '0:0:0': 1 });
});
t('non-zip input gives a clear error', () => assert.throws(() => XR.readXlsx(Buffer.from('hello world, not a zip file at all')), /not a zip/));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

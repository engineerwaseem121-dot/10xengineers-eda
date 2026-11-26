'use strict';
/* RISC-V (RV32GC / RV64GC) assembly: instruction table, completion and hover. */

// [mnemonic, operands, description, extension]
const I = [
  // RV32I
  ['lui', 'rd, imm20', 'Load upper immediate: rd = imm << 12', 'I'], ['auipc', 'rd, imm20', 'Add upper immediate to PC: rd = pc + (imm << 12)', 'I'],
  ['jal', 'rd, offset', 'Jump and link: rd = pc+4; pc += offset', 'I'], ['jalr', 'rd, offset(rs1)', 'Jump and link register: rd = pc+4; pc = (rs1+offset) & ~1', 'I'],
  ['beq', 'rs1, rs2, label', 'Branch if equal', 'I'], ['bne', 'rs1, rs2, label', 'Branch if not equal', 'I'], ['blt', 'rs1, rs2, label', 'Branch if less than (signed)', 'I'],
  ['bge', 'rs1, rs2, label', 'Branch if greater or equal (signed)', 'I'], ['bltu', 'rs1, rs2, label', 'Branch if less than (unsigned)', 'I'], ['bgeu', 'rs1, rs2, label', 'Branch if greater or equal (unsigned)', 'I'],
  ['lb', 'rd, offset(rs1)', 'Load byte (sign-extended)', 'I'], ['lh', 'rd, offset(rs1)', 'Load halfword (sign-extended)', 'I'], ['lw', 'rd, offset(rs1)', 'Load word', 'I'],
  ['lbu', 'rd, offset(rs1)', 'Load byte unsigned', 'I'], ['lhu', 'rd, offset(rs1)', 'Load halfword unsigned', 'I'],
  ['sb', 'rs2, offset(rs1)', 'Store byte', 'I'], ['sh', 'rs2, offset(rs1)', 'Store halfword', 'I'], ['sw', 'rs2, offset(rs1)', 'Store word', 'I'],
  ['addi', 'rd, rs1, imm12', 'Add immediate', 'I'], ['slti', 'rd, rs1, imm12', 'Set if less than immediate (signed)', 'I'], ['sltiu', 'rd, rs1, imm12', 'Set if less than immediate (unsigned)', 'I'],
  ['xori', 'rd, rs1, imm12', 'XOR immediate', 'I'], ['ori', 'rd, rs1, imm12', 'OR immediate', 'I'], ['andi', 'rd, rs1, imm12', 'AND immediate', 'I'],
  ['slli', 'rd, rs1, shamt', 'Shift left logical immediate', 'I'], ['srli', 'rd, rs1, shamt', 'Shift right logical immediate', 'I'], ['srai', 'rd, rs1, shamt', 'Shift right arithmetic immediate', 'I'],
  ['add', 'rd, rs1, rs2', 'Add', 'I'], ['sub', 'rd, rs1, rs2', 'Subtract', 'I'], ['sll', 'rd, rs1, rs2', 'Shift left logical', 'I'], ['slt', 'rd, rs1, rs2', 'Set if less than (signed)', 'I'],
  ['sltu', 'rd, rs1, rs2', 'Set if less than (unsigned)', 'I'], ['xor', 'rd, rs1, rs2', 'XOR', 'I'], ['srl', 'rd, rs1, rs2', 'Shift right logical', 'I'], ['sra', 'rd, rs1, rs2', 'Shift right arithmetic', 'I'],
  ['or', 'rd, rs1, rs2', 'OR', 'I'], ['and', 'rd, rs1, rs2', 'AND', 'I'], ['fence', 'pred, succ', 'Memory ordering fence', 'I'], ['ecall', '', 'Environment call (trap to higher privilege)', 'I'], ['ebreak', '', 'Breakpoint trap', 'I'],
  // RV64I
  ['lwu', 'rd, offset(rs1)', 'Load word unsigned (RV64)', 'I64'], ['ld', 'rd, offset(rs1)', 'Load doubleword (RV64)', 'I64'], ['sd', 'rs2, offset(rs1)', 'Store doubleword (RV64)', 'I64'],
  ['addiw', 'rd, rs1, imm12', 'Add immediate word, sign-extend 32-bit result (RV64)', 'I64'], ['slliw', 'rd, rs1, shamt', 'Shift left logical immediate word (RV64)', 'I64'],
  ['srliw', 'rd, rs1, shamt', 'Shift right logical immediate word (RV64)', 'I64'], ['sraiw', 'rd, rs1, shamt', 'Shift right arithmetic immediate word (RV64)', 'I64'],
  ['addw', 'rd, rs1, rs2', 'Add word (RV64)', 'I64'], ['subw', 'rd, rs1, rs2', 'Subtract word (RV64)', 'I64'], ['sllw', 'rd, rs1, rs2', 'Shift left logical word (RV64)', 'I64'],
  ['srlw', 'rd, rs1, rs2', 'Shift right logical word (RV64)', 'I64'], ['sraw', 'rd, rs1, rs2', 'Shift right arithmetic word (RV64)', 'I64'],
  // Zifencei / Zicsr
  ['fence.i', '', 'Instruction-fetch fence', 'Zifencei'],
  ['csrrw', 'rd, csr, rs1', 'Atomic read/write CSR', 'Zicsr'], ['csrrs', 'rd, csr, rs1', 'Atomic read and set bits in CSR', 'Zicsr'], ['csrrc', 'rd, csr, rs1', 'Atomic read and clear bits in CSR', 'Zicsr'],
  ['csrrwi', 'rd, csr, uimm5', 'Read/write CSR immediate', 'Zicsr'], ['csrrsi', 'rd, csr, uimm5', 'Read and set CSR immediate', 'Zicsr'], ['csrrci', 'rd, csr, uimm5', 'Read and clear CSR immediate', 'Zicsr'],
  // M
  ['mul', 'rd, rs1, rs2', 'Multiply (low XLEN bits)', 'M'], ['mulh', 'rd, rs1, rs2', 'Multiply high signed×signed', 'M'], ['mulhsu', 'rd, rs1, rs2', 'Multiply high signed×unsigned', 'M'],
  ['mulhu', 'rd, rs1, rs2', 'Multiply high unsigned×unsigned', 'M'], ['div', 'rd, rs1, rs2', 'Divide (signed)', 'M'], ['divu', 'rd, rs1, rs2', 'Divide (unsigned)', 'M'],
  ['rem', 'rd, rs1, rs2', 'Remainder (signed)', 'M'], ['remu', 'rd, rs1, rs2', 'Remainder (unsigned)', 'M'],
  ['mulw', 'rd, rs1, rs2', 'Multiply word (RV64)', 'M64'], ['divw', 'rd, rs1, rs2', 'Divide word (RV64)', 'M64'], ['divuw', 'rd, rs1, rs2', 'Divide word unsigned (RV64)', 'M64'],
  ['remw', 'rd, rs1, rs2', 'Remainder word (RV64)', 'M64'], ['remuw', 'rd, rs1, rs2', 'Remainder word unsigned (RV64)', 'M64'],
  // A
  ['lr.w', 'rd, (rs1)', 'Load-reserved word', 'A'], ['sc.w', 'rd, rs2, (rs1)', 'Store-conditional word', 'A'],
  ...['swap', 'add', 'xor', 'and', 'or', 'min', 'max', 'minu', 'maxu'].map(o => ['amo' + o + '.w', 'rd, rs2, (rs1)', `Atomic memory op: ${o} word`, 'A']),
  ['lr.d', 'rd, (rs1)', 'Load-reserved doubleword (RV64)', 'A64'], ['sc.d', 'rd, rs2, (rs1)', 'Store-conditional doubleword (RV64)', 'A64'],
  ...['swap', 'add', 'xor', 'and', 'or', 'min', 'max', 'minu', 'maxu'].map(o => ['amo' + o + '.d', 'rd, rs2, (rs1)', `Atomic memory op: ${o} doubleword (RV64)`, 'A64']),
  // F / D
  ['flw', 'fd, offset(rs1)', 'Load single-precision float', 'F'], ['fsw', 'fs2, offset(rs1)', 'Store single-precision float', 'F'],
  ['fld', 'fd, offset(rs1)', 'Load double-precision float', 'D'], ['fsd', 'fs2, offset(rs1)', 'Store double-precision float', 'D'],
  ...[['s', 'F', 'single'], ['d', 'D', 'double']].flatMap(([p, e, w]) => [
    ['fadd.' + p, 'fd, fs1, fs2', `Add (${w})`, e], ['fsub.' + p, 'fd, fs1, fs2', `Subtract (${w})`, e], ['fmul.' + p, 'fd, fs1, fs2', `Multiply (${w})`, e],
    ['fdiv.' + p, 'fd, fs1, fs2', `Divide (${w})`, e], ['fsqrt.' + p, 'fd, fs1', `Square root (${w})`, e], ['fmin.' + p, 'fd, fs1, fs2', `Minimum (${w})`, e], ['fmax.' + p, 'fd, fs1, fs2', `Maximum (${w})`, e],
    ['fmadd.' + p, 'fd, fs1, fs2, fs3', `Fused multiply-add (${w})`, e], ['fmsub.' + p, 'fd, fs1, fs2, fs3', `Fused multiply-subtract (${w})`, e],
    ['fnmadd.' + p, 'fd, fs1, fs2, fs3', `Negated fused multiply-add (${w})`, e], ['fnmsub.' + p, 'fd, fs1, fs2, fs3', `Negated fused multiply-subtract (${w})`, e],
    ['fsgnj.' + p, 'fd, fs1, fs2', `Sign inject (${w})`, e], ['fsgnjn.' + p, 'fd, fs1, fs2', `Sign inject negated (${w})`, e], ['fsgnjx.' + p, 'fd, fs1, fs2', `Sign inject XOR (${w})`, e],
    ['feq.' + p, 'rd, fs1, fs2', `Compare equal (${w})`, e], ['flt.' + p, 'rd, fs1, fs2', `Compare less than (${w})`, e], ['fle.' + p, 'rd, fs1, fs2', `Compare less or equal (${w})`, e],
    ['fclass.' + p, 'rd, fs1', `Classify (${w})`, e], ['fcvt.w.' + p, 'rd, fs1', `Convert ${w} → int32`, e], ['fcvt.wu.' + p, 'rd, fs1', `Convert ${w} → uint32`, e],
    ['fcvt.' + p + '.w', 'fd, rs1', `Convert int32 → ${w}`, e], ['fcvt.' + p + '.wu', 'fd, rs1', `Convert uint32 → ${w}`, e],
    ['fcvt.l.' + p, 'rd, fs1', `Convert ${w} → int64 (RV64)`, e], ['fcvt.lu.' + p, 'rd, fs1', `Convert ${w} → uint64 (RV64)`, e],
    ['fcvt.' + p + '.l', 'fd, rs1', `Convert int64 → ${w} (RV64)`, e], ['fcvt.' + p + '.lu', 'fd, rs1', `Convert uint64 → ${w} (RV64)`, e],
    ['fmv.' + p, 'fd, fs1', `Move (${w}, pseudo)`, e], ['fabs.' + p, 'fd, fs1', `Absolute value (${w}, pseudo)`, e], ['fneg.' + p, 'fd, fs1', `Negate (${w}, pseudo)`, e]
  ]),
  ['fcvt.s.d', 'fd, fs1', 'Convert double → single', 'D'], ['fcvt.d.s', 'fd, fs1', 'Convert single → double', 'D'],
  ['fmv.x.w', 'rd, fs1', 'Move float bits → integer register', 'F'], ['fmv.w.x', 'fd, rs1', 'Move integer bits → float register', 'F'],
  ['fmv.x.d', 'rd, fs1', 'Move double bits → integer register (RV64)', 'D'], ['fmv.d.x', 'fd, rs1', 'Move integer bits → double register (RV64)', 'D'],
  ['frcsr', 'rd', 'Read FCSR (pseudo)', 'F'], ['fscsr', 'rd, rs1', 'Swap FCSR (pseudo)', 'F'], ['frrm', 'rd', 'Read rounding mode (pseudo)', 'F'], ['fsrm', 'rd, rs1', 'Swap rounding mode (pseudo)', 'F'],
  ['frflags', 'rd', 'Read exception flags (pseudo)', 'F'], ['fsflags', 'rd, rs1', 'Swap exception flags (pseudo)', 'F'],
  // C
  ...[['c.addi', 'rd, nzimm'], ['c.li', 'rd, imm'], ['c.lui', 'rd, nzimm'], ['c.addi16sp', 'sp, nzimm'], ['c.addi4spn', "rd', nzuimm"], ['c.slli', 'rd, shamt'], ['c.srli', "rd', shamt"], ['c.srai', "rd', shamt"],
    ['c.andi', "rd', imm"], ['c.mv', 'rd, rs2'], ['c.add', 'rd, rs2'], ['c.sub', "rd', rs2'"], ['c.xor', "rd', rs2'"], ['c.or', "rd', rs2'"], ['c.and', "rd', rs2'"], ['c.addw', "rd', rs2'"], ['c.subw', "rd', rs2'"],
    ['c.addiw', 'rd, imm'], ['c.lw', "rd', offset(rs1')"], ['c.sw', "rs2', offset(rs1')"], ['c.ld', "rd', offset(rs1')"], ['c.sd', "rs2', offset(rs1')"], ['c.lwsp', 'rd, offset(sp)'], ['c.swsp', 'rs2, offset(sp)'],
    ['c.ldsp', 'rd, offset(sp)'], ['c.sdsp', 'rs2, offset(sp)'], ['c.fld', "fd', offset(rs1')"], ['c.fsd', "fs2', offset(rs1')"], ['c.fldsp', 'fd, offset(sp)'], ['c.fsdsp', 'fs2, offset(sp)'],
    ['c.j', 'offset'], ['c.jal', 'offset'], ['c.jr', 'rs1'], ['c.jalr', 'rs1'], ['c.beqz', "rs1', offset"], ['c.bnez', "rs1', offset"], ['c.nop', ''], ['c.ebreak', '']].map(([m, o]) => [m, o, 'Compressed (16-bit) form of ' + m.slice(2), 'C']),
  // privileged
  ['mret', '', 'Return from machine-mode trap', 'Priv'], ['sret', '', 'Return from supervisor-mode trap', 'Priv'], ['wfi', '', 'Wait for interrupt', 'Priv'], ['sfence.vma', 'rs1, rs2', 'Supervisor TLB fence', 'Priv'],
  // pseudo instructions
  ['nop', '', 'No operation (addi x0, x0, 0)', 'pseudo'], ['li', 'rd, imm', 'Load immediate', 'pseudo'], ['la', 'rd, symbol', 'Load address', 'pseudo'], ['lla', 'rd, symbol', 'Load local address', 'pseudo'],
  ['mv', 'rd, rs', 'Copy register (addi rd, rs, 0)', 'pseudo'], ['not', 'rd, rs', "One's complement (xori rd, rs, -1)", 'pseudo'], ['neg', 'rd, rs', "Two's complement (sub rd, x0, rs)", 'pseudo'],
  ['negw', 'rd, rs', 'Negate word (RV64)', 'pseudo'], ['sext.w', 'rd, rs', 'Sign-extend word (addiw rd, rs, 0)', 'pseudo'], ['seqz', 'rd, rs', 'Set if = zero', 'pseudo'], ['snez', 'rd, rs', 'Set if ≠ zero', 'pseudo'],
  ['sltz', 'rd, rs', 'Set if < zero', 'pseudo'], ['sgtz', 'rd, rs', 'Set if > zero', 'pseudo'], ['beqz', 'rs, label', 'Branch if = zero', 'pseudo'], ['bnez', 'rs, label', 'Branch if ≠ zero', 'pseudo'],
  ['blez', 'rs, label', 'Branch if ≤ zero', 'pseudo'], ['bgez', 'rs, label', 'Branch if ≥ zero', 'pseudo'], ['bltz', 'rs, label', 'Branch if < zero', 'pseudo'], ['bgtz', 'rs, label', 'Branch if > zero', 'pseudo'],
  ['bgt', 'rs, rt, label', 'Branch if >', 'pseudo'], ['ble', 'rs, rt, label', 'Branch if ≤', 'pseudo'], ['bgtu', 'rs, rt, label', 'Branch if >, unsigned', 'pseudo'], ['bleu', 'rs, rt, label', 'Branch if ≤, unsigned', 'pseudo'],
  ['j', 'label', 'Jump (jal x0, label)', 'pseudo'], ['jr', 'rs', 'Jump register (jalr x0, 0(rs))', 'pseudo'], ['ret', '', 'Return from subroutine (jalr x0, 0(ra))', 'pseudo'],
  ['call', 'symbol', 'Call far-away subroutine (auipc + jalr)', 'pseudo'], ['tail', 'symbol', 'Tail call far-away subroutine', 'pseudo'],
  ['csrr', 'rd, csr', 'Read CSR', 'pseudo'], ['csrw', 'csr, rs', 'Write CSR', 'pseudo'], ['csrs', 'csr, rs', 'Set bits in CSR', 'pseudo'], ['csrc', 'csr, rs', 'Clear bits in CSR', 'pseudo'],
  ['csrwi', 'csr, imm', 'Write CSR immediate', 'pseudo'], ['csrsi', 'csr, imm', 'Set CSR bits immediate', 'pseudo'], ['csrci', 'csr, imm', 'Clear CSR bits immediate', 'pseudo'],
  ['rdcycle', 'rd', 'Read cycle counter', 'pseudo'], ['rdtime', 'rd', 'Read real-time clock', 'pseudo'], ['rdinstret', 'rd', 'Read instructions-retired counter', 'pseudo']
];

const DIRECTIVES = [
  ['.text', 'Switch to the code section'], ['.data', 'Switch to the initialized data section'], ['.bss', 'Switch to the zero-initialized data section'], ['.rodata', 'Read-only data section'],
  ['.section', 'Switch to a named section: .section name, "flags", @type'], ['.globl', 'Make a symbol global'], ['.global', 'Make a symbol global'], ['.local', 'Make a symbol local'],
  ['.weak', 'Declare a weak symbol'], ['.type', 'Set symbol type: .type sym, @function'], ['.size', 'Set symbol size: .size sym, .-sym'], ['.align', 'Align to 2^n bytes'], ['.p2align', 'Align to 2^n bytes'],
  ['.balign', 'Align to n bytes'], ['.byte', 'Emit 8-bit values'], ['.half', 'Emit 16-bit values'], ['.2byte', 'Emit 16-bit values'], ['.word', 'Emit 32-bit values'], ['.4byte', 'Emit 32-bit values'],
  ['.dword', 'Emit 64-bit values'], ['.8byte', 'Emit 64-bit values'], ['.quad', 'Emit 64-bit values'], ['.float', 'Emit single-precision values'], ['.double', 'Emit double-precision values'],
  ['.string', 'Emit NUL-terminated string'], ['.asciz', 'Emit NUL-terminated string'], ['.ascii', 'Emit string without NUL'], ['.zero', 'Emit n zero bytes'], ['.skip', 'Reserve n bytes'], ['.space', 'Reserve n bytes'],
  ['.equ', 'Define a constant: .equ NAME, value'], ['.set', 'Define a symbol value'], ['.option', 'Assembler option: rvc, norvc, push, pop, relax, norelax, pic, nopic, arch'],
  ['.attribute', 'RISC-V ELF attribute (e.g. arch, "rv64gc")'], ['.macro', 'Begin macro definition'], ['.endm', 'End macro definition'], ['.rept', 'Repeat block n times'], ['.endr', 'End repeat block'],
  ['.include', 'Include another source file'], ['.file', 'Source file name for debug info'], ['.ident', 'Identification string'], ['.comm', 'Declare common symbol'], ['.lcomm', 'Declare local common symbol'],
  ['.if', 'Conditional assembly'], ['.ifdef', 'Assemble if symbol defined'], ['.ifndef', 'Assemble if symbol not defined'], ['.else', 'Conditional else'], ['.endif', 'End conditional'],
  ['.insn', 'Emit a raw instruction by format'], ['.cfi_startproc', 'Begin CFI procedure'], ['.cfi_endproc', 'End CFI procedure'], ['.end', 'End of assembly']
];

const REGS = [];
for (let i = 0; i < 32; i++) REGS.push(['x' + i, `Integer register x${i}`], ['f' + i, `Floating-point register f${i}`]);
const ABI = { zero: 'x0 hard-wired zero', ra: 'x1 return address', sp: 'x2 stack pointer', gp: 'x3 global pointer', tp: 'x4 thread pointer', t0: 'x5 temporary', t1: 'x6 temporary', t2: 'x7 temporary', s0: 'x8 saved / frame pointer', fp: 'x8 frame pointer', s1: 'x9 saved', a0: 'x10 argument / return value', a1: 'x11 argument / return value' };
for (let i = 2; i <= 7; i++) ABI['a' + i] = `x${10 + i} function argument`;
for (let i = 2; i <= 11; i++) ABI['s' + i] = `x${16 + i} saved register`;
for (let i = 3; i <= 6; i++) ABI['t' + i] = `x${25 + i} temporary`;
for (let i = 0; i <= 7; i++) { ABI['ft' + i] = `f${i} FP temporary`; ABI['fa' + i] = `f${10 + i} FP argument`; }
ABI.fs0 = 'f8 FP saved'; ABI.fs1 = 'f9 FP saved';
for (let i = 2; i <= 11; i++) ABI['fs' + i] = `f${16 + i} FP saved`;
ABI.ft8 = 'f28 FP temporary'; ABI.ft9 = 'f29'; ABI.ft10 = 'f30'; ABI.ft11 = 'f31';
const CSRS = ['mstatus', 'misa', 'medeleg', 'mideleg', 'mie', 'mtvec', 'mcounteren', 'mscratch', 'mepc', 'mcause', 'mtval', 'mip', 'mhartid', 'mvendorid', 'marchid', 'mimpid', 'mcycle', 'minstret',
  'sstatus', 'sie', 'stvec', 'sscratch', 'sepc', 'scause', 'stval', 'sip', 'satp', 'fflags', 'frm', 'fcsr', 'cycle', 'time', 'instret', 'pmpcfg0', 'pmpaddr0', 'mtime', 'mtimecmp'];

const BY_NAME = new Map(I.map(x => [x[0], x]));

module.exports = { INSTRUCTIONS: I, DIRECTIVES, REGS, ABI, CSRS, BY_NAME };

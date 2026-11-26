/* RISC-V RV64GC demo for 10xEngineers EDA: syntax highlighting, completion and hover */
#include "platform.h"

    .option norvc
    .attribute arch, "rv64gc"
    .section .text.init, "ax", @progbits
    .globl _start
    .type  _start, @function

_start:
    csrr    t0, mhartid          # only hart 0 continues
    bnez    t0, park
    la      sp, _stack_top       # set up the stack
    la      a0, msg
    call    puts
    li      a1, 10
    li      a2, 0
1:  add     a2, a2, a1           // sum 10 + 9 + ... + 1
    addi    a1, a1, -1
    bnez    a1, 1b
    fcvt.d.l fa0, a2
    fsqrt.d fa1, fa0
    amoadd.w.aq zero, a2, (sp)
    c.nop
    ecall

park:
    wfi
    j       park

    .section .rodata
msg: .asciz "hello from RV64GC\n"
    .align 3
table: .dword 0x8000000000000000, 42

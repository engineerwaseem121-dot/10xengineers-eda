/* RISC-V bare-metal linker script */
OUTPUT_ARCH("riscv")
ENTRY(_start)

MEMORY
{
  ROM (rx)  : ORIGIN = 0x80000000, LENGTH = 128K
  RAM (rwx) : ORIGIN = 0x80020000, LENGTH = 64K
}

SECTIONS
{
  .text : {
    KEEP(*(.text.init))
    *(.text .text.*)
  } > ROM

  .rodata : ALIGN(8) { *(.rodata .rodata.*) } > ROM

  .data : ALIGN(8) {
    __data_start = .;
    *(.data .data.*)
    __data_end = .;
  } > RAM AT > ROM

  .bss (NOLOAD) : ALIGN(8) {
    __bss_start = .;
    *(.bss .bss.*) *(COMMON)
    __bss_end = .;
  } > RAM

  PROVIDE(_stack_top = ORIGIN(RAM) + LENGTH(RAM));
}

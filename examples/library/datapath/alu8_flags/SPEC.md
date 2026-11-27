# alu8_flags: 8-bit ALU with status flags
## Function
A combinational 8-bit ALU with 16 operations selected by a 4-bit opcode, including signed and unsigned set-less-than and pass-through. Besides the result it produces four status flags: zero, carry, negative and overflow.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | input | 8 | Operand A |
| b | input | 8 | Operand B |
| op | input | 4 | Operation select |
| result | output | 8 | Result |
| zero | output | 1 | `result == 0` |
| carry | output | 1 | Carry out / borrow / shifted-out bit (see table) |
| negative | output | 1 | `result[7]` |
| overflow | output | 1 | Signed (two's complement) overflow (see table) |
## Behaviour
Purely combinational. "Signed" means 8-bit two's complement. Results are taken modulo 256.

| op | Name | result | carry | overflow |
|---|---|---|---|---|
| 0 | ADD | `a + b` | carry out of bit 7: `(a + b) > 255` | `a[7] == b[7] && result[7] != a[7]` |
| 1 | SUB | `a - b` | borrow: `a < b` (unsigned) | `a[7] != b[7] && result[7] != a[7]` |
| 2 | AND | `a & b` | 0 | 0 |
| 3 | OR | `a \| b` | 0 | 0 |
| 4 | XOR | `a ^ b` | 0 | 0 |
| 5 | NOR | `~(a \| b)` | 0 | 0 |
| 6 | NOT | `~a` | 0 | 0 |
| 7 | SHL | `a << 1` (0 in at bit 0) | `a[7]` | 0 |
| 8 | SHR | `a >> 1` logical (0 in at bit 7) | `a[0]` | 0 |
| 9 | SAR | `a >> 1` arithmetic (bit 7 kept) | `a[0]` | 0 |
| 10 | SLT | `1` if `a < b` signed, else `0` | 0 | 0 |
| 11 | SLTU | `1` if `a < b` unsigned, else `0` | 0 | 0 |
| 12 | PASSA | `a` | 0 | 0 |
| 13 | PASSB | `b` | 0 | 0 |
| 14 | INC | `a + 1` | `a == 0xFF` | `a == 0x7F` |
| 15 | DEC | `a - 1` | borrow: `a == 0x00` | `a == 0x80` |

For every op: `zero = (result == 0)` and `negative = result[7]`.

Carry convention for SUB/DEC: `carry` is the borrow (1 when the unsigned subtraction wraps below zero), not the inverted borrow used by some CPUs. Overflow for ADD means two operands of equal sign gave a result of the other sign; for SUB it means operands of different sign gave a result whose sign differs from `a`. All 16 opcodes are defined.
## Example
| op | a | b | result | zero | carry | negative | overflow |
|---|---|---|---|---|---|---|---|
| 0 ADD | 0x7F | 0x01 | 0x80 | 0 | 0 | 1 | 1 |
| 0 ADD | 0xFF | 0x01 | 0x00 | 1 | 1 | 0 | 0 |
| 1 SUB | 0x05 | 0x07 | 0xFE | 0 | 1 | 1 | 0 |
| 1 SUB | 0x80 | 0x01 | 0x7F | 0 | 0 | 0 | 1 |
| 1 SUB | 0x33 | 0x33 | 0x00 | 1 | 0 | 0 | 0 |
| 9 SAR | 0x81 | - | 0xC0 | 0 | 1 | 1 | 0 |
| 10 SLT | 0xFF | 0x01 | 0x01 | 0 | 0 | 0 | 0 |
| 11 SLTU | 0xFF | 0x01 | 0x00 | 1 | 0 | 0 | 0 |
| 13 PASSB | 0x12 | 0x9C | 0x9C | 0 | 0 | 1 | 0 |
| 14 INC | 0x7F | - | 0x80 | 0 | 0 | 1 | 1 |

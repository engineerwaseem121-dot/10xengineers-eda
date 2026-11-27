# alu4: 4-bit ALU
## Function
A small combinational ALU. A 3-bit opcode selects one of eight arithmetic, logic or shift operations on two 4-bit operands. A `zero` flag reports when the result is 0.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | input | 4 | Operand A |
| b | input | 4 | Operand B |
| op | input | 3 | Operation select |
| result | output | 4 | Result |
| zero | output | 1 | 1 when `result == 0` |
## Behaviour
Purely combinational. All arithmetic is unsigned modulo 16 (carries and borrows are dropped).

| op | Name | result |
|---|---|---|
| 0 | ADD | `(a + b) mod 16` |
| 1 | SUB | `(a - b) mod 16` |
| 2 | AND | `a & b` |
| 3 | OR | `a \| b` |
| 4 | XOR | `a ^ b` |
| 5 | NOT | `~a` (b ignored) |
| 6 | SHL | `(a << 1) mod 16`, a 0 enters at bit 0 (b ignored) |
| 7 | SHR | `a >> 1`, a 0 enters at bit 3 (b ignored) |

`zero = (result == 4'b0000)` for every op. All opcodes are defined.
## Example
| a | b | op | result | zero |
|---|---|---|---|---|
| 0101 | 0011 | 0 ADD | 1000 | 0 |
| 1111 | 0001 | 0 ADD | 0000 | 1 |
| 0101 | 0011 | 1 SUB | 0010 | 0 |
| 0011 | 0101 | 1 SUB | 1110 | 0 |
| 0101 | 0011 | 2 AND | 0001 | 0 |
| 0101 | 0011 | 3 OR | 0111 | 0 |
| 0101 | 0101 | 4 XOR | 0000 | 1 |
| 0101 | xxxx | 5 NOT | 1010 | 0 |
| 1101 | xxxx | 6 SHL | 1010 | 0 |
| 1101 | xxxx | 7 SHR | 0110 | 0 |

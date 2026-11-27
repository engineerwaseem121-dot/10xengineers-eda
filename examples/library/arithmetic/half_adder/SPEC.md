# half_adder: 1-bit half adder
## Function
Adds two single-bit operands with no carry input. Produces the 1-bit sum and the carry out. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | - | - |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | 1 | Operand A |
| b | in | 1 | Operand B |
| sum | out | 1 | Sum bit |
| carry | out | 1 | Carry out |
## Behaviour
- `sum = a ^ b`
- `carry = a & b`

Equivalently `{carry, sum} = a + b` (2-bit result).
## Example
| a | b | carry | sum |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 0 | 1 | 0 | 1 |
| 1 | 0 | 0 | 1 |
| 1 | 1 | 1 | 0 |

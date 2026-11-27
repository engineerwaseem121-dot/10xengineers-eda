# full_adder: 1-bit full adder
## Function
Adds two single-bit operands and a carry input. Produces the 1-bit sum and the carry out. Purely combinational; the basic cell of a ripple-carry adder.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | - | - |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | 1 | Operand A |
| b | in | 1 | Operand B |
| cin | in | 1 | Carry in |
| sum | out | 1 | Sum bit |
| cout | out | 1 | Carry out |
## Behaviour
- `sum  = a ^ b ^ cin`
- `cout = (a & b) | ((a ^ b) & cin)` (majority of a, b, cin)

Equivalently `{cout, sum} = a + b + cin`.
## Example
| a | b | cin | cout | sum |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 0 | 1 |
| 1 | 1 | 0 | 1 | 0 |
| 0 | 1 | 1 | 1 | 0 |
| 1 | 1 | 1 | 1 | 1 |

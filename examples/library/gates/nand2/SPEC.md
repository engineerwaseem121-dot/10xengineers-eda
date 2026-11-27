# nand2: 2-input NAND gate
## Function
Single-bit 2-input NAND gate. y is 0 only when both inputs are 1. The output is purely combinational and changes as soon as an input changes.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | - | - |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | 1 | First operand |
| b | in | 1 | Second operand |
| y | out | 1 | Gate output |
## Behaviour
`y = ~(a & b)` (combinational, no clock, no reset, no state).
## Example
| a | b | y |
|---|---|---|
| 0 | 0 | 1 |
| 0 | 1 | 1 |
| 1 | 0 | 1 |
| 1 | 1 | 0 |

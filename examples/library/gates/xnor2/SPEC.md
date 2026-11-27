# xnor2: 2-input XNOR gate
## Function
Single-bit 2-input XNOR gate. y is 1 when the inputs are equal. The output is purely combinational and changes as soon as an input changes.
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
`y = ~(a ^ b)` (combinational, no clock, no reset, no state).
## Example
| a | b | y |
|---|---|---|
| 0 | 0 | 1 |
| 0 | 1 | 0 |
| 1 | 0 | 0 |
| 1 | 1 | 1 |

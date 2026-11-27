# not1: NOT (inverter) gate
## Function
Single-bit NOT (inverter) gate. y is the logical inverse of a. The output is purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | - | - |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | 1 | Input |
| y | out | 1 | Output |
## Behaviour
`y = ~a` (combinational, no clock, no reset, no state).
## Example
| a | y |
|---|---|
| 0 | 1 |
| 1 | 0 |

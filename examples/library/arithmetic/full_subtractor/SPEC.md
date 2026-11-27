# full_subtractor: 1-bit full subtractor
## Function
Subtracts single bit `b` and a borrow input `bin` from single bit `a`. Produces the difference bit and a borrow out. Purely combinational; the basic cell of a ripple-borrow subtractor.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | - | - |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | 1 | Minuend |
| b | in | 1 | Subtrahend |
| bin | in | 1 | Borrow in |
| diff | out | 1 | Difference bit |
| bout | out | 1 | Borrow out |
## Behaviour
- `diff = a ^ b ^ bin`
- `bout = (~a & b) | (~(a ^ b) & bin)`

Equivalently `a - b - bin = diff - 2*bout`; `bout = 1` exactly when `a < b + bin`.
## Example
| a | b | bin | bout | diff |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 |
| 0 | 0 | 1 | 1 | 1 |
| 0 | 1 | 1 | 1 | 0 |
| 1 | 0 | 1 | 0 | 0 |
| 1 | 1 | 1 | 1 | 1 |

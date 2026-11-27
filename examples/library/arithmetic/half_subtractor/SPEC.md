# half_subtractor: 1-bit half subtractor
## Function
Subtracts single bit `b` from single bit `a` with no borrow input. Produces the difference bit and a borrow out that is 1 when `b > a`. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | - | - |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | 1 | Minuend |
| b | in | 1 | Subtrahend |
| diff | out | 1 | Difference bit |
| borrow | out | 1 | Borrow out (1 when a < b) |
## Behaviour
- `diff = a ^ b`
- `borrow = ~a & b`

Equivalently `a - b = diff - 2*borrow`.
## Example
| a | b | borrow | diff |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 0 | 1 | 1 | 1 |
| 1 | 0 | 0 | 1 |
| 1 | 1 | 0 | 0 |

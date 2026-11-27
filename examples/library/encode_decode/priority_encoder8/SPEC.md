# priority_encoder8: 8-input priority encoder
## Function
Outputs the binary index of the highest-numbered input bit that is set. `valid` tells whether any input bit is set. Any input pattern is legal.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| in | input | 8 | Request bits; in[7] has the highest priority |
| out | output | 3 | Index of the highest set bit |
| valid | output | 1 | 1 when at least one bit of `in` is set |
## Behaviour
Purely combinational:
- `valid = |in`
- `out = max { i : in[i] == 1 }` when `valid = 1`.
- When `in = 0`: `valid = 0`, `out = 0`.
## Example
| in | out | valid |
|---|---|---|
| 00000000 | 000 | 0 |
| 00000001 | 000 | 1 |
| 00001010 | 011 | 1 |
| 01000001 | 110 | 1 |
| 11111111 | 111 | 1 |

# priority_encoder4: 4-input priority encoder
## Function
Outputs the binary index of the highest-numbered input bit that is set. `valid` tells whether any input bit is set at all. Any input pattern is legal.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| in | input | 4 | Request bits; in[3] has the highest priority |
| out | output | 2 | Index of the highest set bit |
| valid | output | 1 | 1 when at least one bit of `in` is set |
## Behaviour
Purely combinational:
- `valid = in[3] | in[2] | in[1] | in[0]`
- `out = 3` if `in[3]`, else `2` if `in[2]`, else `1` if `in[1]`, else `0`.

When `in = 0`, `valid = 0` and `out = 0`.
## Example
| in | out | valid |
|---|---|---|
| 0000 | 00 | 0 |
| 0001 | 00 | 1 |
| 0011 | 01 | 1 |
| 0110 | 10 | 1 |
| 1001 | 11 | 1 |

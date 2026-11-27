# encoder4to2: 4-to-2 binary encoder
## Function
Converts a one-hot 4-bit input into the 2-bit binary index of the bit that is set. It is a plain OR-type encoder: it has no priority logic and no valid output, so the input is expected to be one-hot.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| in | input | 4 | One-hot input, bit i set means index i |
| out | output | 2 | Binary index of the set bit |
## Behaviour
Purely combinational:
- `out[0] = in[1] | in[3]`
- `out[1] = in[2] | in[3]`

For a one-hot input, `out` is the index of the set bit. For `in = 0`, `out = 0`. For a non-one-hot input, `out` is the bitwise OR of the indices of all set bits (e.g. `in = 4'b0110` gives `out = 2'b11`).
## Example
| in | out |
|---|---|
| 0001 | 00 |
| 0010 | 01 |
| 0100 | 10 |
| 1000 | 11 |
| 0000 | 00 |
| 0110 | 11 |

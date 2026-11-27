# encoder8to3: 8-to-3 binary encoder
## Function
Converts a one-hot 8-bit input into the 3-bit binary index of the bit that is set. It is a plain OR-type encoder without priority logic or valid output; the input is expected to be one-hot.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| in | input | 8 | One-hot input, bit i set means index i |
| out | output | 3 | Binary index of the set bit |
## Behaviour
Purely combinational:
- `out[0] = in[1] | in[3] | in[5] | in[7]`
- `out[1] = in[2] | in[3] | in[6] | in[7]`
- `out[2] = in[4] | in[5] | in[6] | in[7]`

For a one-hot input, `out` is the index of the set bit. For `in = 0`, `out = 0`. For a non-one-hot input, `out` is the bitwise OR of the indices of all set bits.
## Example
| in | out |
|---|---|
| 00000001 | 000 |
| 00000100 | 010 |
| 00100000 | 101 |
| 10000000 | 111 |
| 00000000 | 000 |
| 00010010 | 101 |

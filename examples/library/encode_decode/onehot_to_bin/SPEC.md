# onehot_to_bin: parameterized one-hot to binary encoder
## Function
Converts an N-bit one-hot vector into the binary index of its set bit. The output width is `$clog2(N)`. It is an OR-type encoder without priority logic; the input is expected to be one-hot.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| N | 8 | Number of one-hot input bits (N >= 2) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| onehot | input | N | One-hot input, bit i set means index i |
| bin | output | $clog2(N) | Binary index of the set bit |
## Behaviour
Purely combinational. For each output bit k: `bin[k] = OR of onehot[i] over all i in 0..N-1 whose bit k is 1`.

Equivalently `bin` is the bitwise OR of the indices of all set input bits, so:
- one-hot input with bit i set: `bin = i`
- `onehot = 0`: `bin = 0`
- more than one bit set: bitwise OR of their indices (not a priority result).
## Example
N = 8:

| onehot | bin |
|---|---|
| 00000001 | 000 |
| 00001000 | 011 |
| 01000000 | 110 |
| 00000000 | 000 |
| 00010100 | 110 |

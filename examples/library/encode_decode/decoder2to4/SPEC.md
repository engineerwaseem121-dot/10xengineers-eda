# decoder2to4: 2-to-4 one-hot decoder
## Function
Converts a 2-bit binary value into a 4-bit one-hot vector. Exactly one output bit is high: the one whose index equals the input value.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| in | input | 2 | Binary select value |
| out | output | 4 | One-hot output, out[in] = 1 |
## Behaviour
Purely combinational: `out[i] = (in == i)` for i = 0..3, i.e. `out = 4'b0001 << in`. Every input value is legal.
## Example
| in | out |
|---|---|
| 00 | 0001 |
| 01 | 0010 |
| 10 | 0100 |
| 11 | 1000 |

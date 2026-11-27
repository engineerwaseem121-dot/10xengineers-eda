# decoder3to8_en: 3-to-8 decoder with enable
## Function
Converts a 3-bit binary value into an 8-bit one-hot vector when enabled. When the enable is low, all outputs are low.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| en | input | 1 | Enable, active high |
| in | input | 3 | Binary select value |
| out | output | 8 | One-hot output when enabled, all zero otherwise |
## Behaviour
Purely combinational: `out[i] = en & (in == i)` for i = 0..7.
- `en = 1`: exactly one bit, `out[in]`, is 1.
- `en = 0`: `out = 8'b0` regardless of `in`.
## Example
| en | in | out |
|---|---|---|
| 0 | 101 | 00000000 |
| 1 | 000 | 00000001 |
| 1 | 011 | 00001000 |
| 1 | 111 | 10000000 |

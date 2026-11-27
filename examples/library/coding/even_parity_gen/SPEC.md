# even_parity_gen: 8-bit even parity generator
## Function
Produces the even-parity bit for an 8-bit data word. Appending `parity` to `data` gives a 9-bit word with an even number of ones.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| data | input | 8 | Data word |
| parity | output | 1 | Even parity bit |
## Behaviour
Purely combinational: `parity = data[7] ^ data[6] ^ ... ^ data[0]`. So `parity = 1` exactly when `data` has an odd number of ones, and `data` plus `parity` always contains an even number of ones.
## Example
| data | ones in data | parity |
|---|---|---|
| 0x00 | 0 | 0 |
| 0x01 | 1 | 1 |
| 0x03 | 2 | 0 |
| 0x07 | 3 | 1 |
| 0xA5 | 4 | 0 |
| 0xFE | 7 | 1 |
| 0xFF | 8 | 0 |

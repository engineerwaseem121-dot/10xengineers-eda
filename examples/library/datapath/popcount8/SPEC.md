# popcount8: 8-bit population count
## Function
Counts the number of bits set to 1 in an 8-bit word. The result ranges from 0 to 8. Implemented as a tree of small adders (pairs, then nibbles, then the byte).
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| in | input | 8 | Input word |
| count | output | 4 | Number of ones in `in`, 0..8 |
## Behaviour
Purely combinational: `count = in[0] + in[1] + ... + in[7]` (each bit counted as 0 or 1). Every input value is legal.
## Example
| in | count |
|---|---|
| 00000000 | 0 |
| 00000001 | 1 |
| 10000001 | 2 |
| 01010101 | 4 |
| 11101111 | 7 |
| 11111111 | 8 |

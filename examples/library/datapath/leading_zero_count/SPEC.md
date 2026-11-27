# leading_zero_count: 16-bit leading zero counter
## Function
Counts how many consecutive zero bits there are in a 16-bit word, starting from the most significant bit and stopping at the first one. An all-zero input gives 16.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| in | input | 16 | Input word |
| count | output | 5 | Number of leading zeros, 0..16 |
## Behaviour
Purely combinational:
- `in != 0`: let `h` be the index of the highest set bit; `count = 15 - h`.
- `in == 0`: `count = 16`.

Range is 0 (when `in[15] = 1`) to 16. Every input value is legal.
## Example
| in | count |
|---|---|
| 0x8000 | 0 |
| 0xFFFF | 0 |
| 0x4000 | 1 |
| 0x00F0 | 8 |
| 0x0001 | 15 |
| 0x0000 | 16 |

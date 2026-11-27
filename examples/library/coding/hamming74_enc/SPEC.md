# hamming74_enc: Hamming(7,4) encoder
## Function
Encodes 4 data bits into a 7-bit Hamming codeword with 3 even-parity bits, so that a decoder can correct any single-bit error. Parity bits sit at the power-of-two positions 1, 2 and 4 of the codeword.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| data | input | 4 | Data bits d3..d0 (`data[i]` = di) |
| code | output | 7 | Codeword; `code[k-1]` = codeword position k |
## Behaviour
Purely combinational. Codeword positions (1-based) and bit mapping:

| Position | 7 | 6 | 5 | 4 | 3 | 2 | 1 |
|---|---|---|---|---|---|---|---|
| code bit | code[6] | code[5] | code[4] | code[3] | code[2] | code[1] | code[0] |
| content | d3 | d2 | d1 | p4 | d0 | p2 | p1 |

Parity equations (even parity over the positions whose index has that bit set):
- `p1 = d0 ^ d1 ^ d3` (positions 1, 3, 5, 7)
- `p2 = d0 ^ d2 ^ d3` (positions 2, 3, 6, 7)
- `p4 = d1 ^ d2 ^ d3` (positions 4, 5, 6, 7)

So `code = {d3, d2, d1, p4, d0, p2, p1}`. Every input value is legal.
## Example
| data | code (pos 7..1) |
|---|---|
| 0000 | 0000000 |
| 0001 | 0000111 |
| 1011 | 1010101 |
| 1000 | 1001011 |
| 1111 | 1111111 |

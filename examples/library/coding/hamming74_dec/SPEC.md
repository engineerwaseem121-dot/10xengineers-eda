# hamming74_dec: Hamming(7,4) decoder with single-error correction
## Function
Decodes a 7-bit Hamming codeword (same layout as `hamming74_enc`) into 4 data bits. A 3-bit syndrome locates any single-bit error, which is corrected before the data is extracted; `corrected` reports that a bit was flipped.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| code | input | 7 | Received codeword; `code[k-1]` = position k |
| data | output | 4 | Decoded (corrected) data bits d3..d0 |
| corrected | output | 1 | 1 when the syndrome is non-zero and one bit was flipped |
## Behaviour
Purely combinational. Codeword layout (1-based positions):

| Position | 7 | 6 | 5 | 4 | 3 | 2 | 1 |
|---|---|---|---|---|---|---|---|
| code bit | code[6] | code[5] | code[4] | code[3] | code[2] | code[1] | code[0] |
| content | d3 | d2 | d1 | p4 | d0 | p2 | p1 |

Syndrome `s = {s4, s2, s1}`:
- `s1 = c1 ^ c3 ^ c5 ^ c7`
- `s2 = c2 ^ c3 ^ c6 ^ c7`
- `s4 = c4 ^ c5 ^ c6 ^ c7`

where `ck = code[k-1]`.
- `s = 0`: no error; `corrected = 0`; data taken unchanged.
- `s != 0`: position `s` (1..7) is inverted; `corrected = 1`.

Then `data = {c7, c6, c5, c3}` of the corrected word. With at most one bit error the original data is always recovered. With two or more bit errors the result is a wrong codeword (Hamming(7,4) cannot detect that); every 7-bit input still decodes to the nearest codeword.
## Example
| code (pos 7..1) | data | corrected | note |
|---|---|---|---|
| 1010101 | 1011 | 0 | valid codeword |
| 1000101 | 1011 | 1 | position 5 flipped |
| 1010100 | 1011 | 1 | position 1 (p1) flipped |
| 0000000 | 0000 | 0 | valid codeword |
| 1000000 | 0000 | 1 | position 7 flipped |

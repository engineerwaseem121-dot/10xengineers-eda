# bin2bcd8: 8-bit binary to BCD converter
## Function
Converts an unsigned 8-bit binary number (0..255) into three BCD digits: hundreds, tens and ones. The conversion is purely combinational and uses the shift-and-add-3 (double-dabble) method.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| bin | input | 8 | Unsigned binary value 0..255 |
| bcd | output | 12 | BCD digits: bcd[11:8] = hundreds, bcd[7:4] = tens, bcd[3:0] = ones |
## Behaviour
Purely combinational:
- `bcd[11:8] = bin / 100` (0..2)
- `bcd[7:4] = (bin / 10) % 10` (0..9)
- `bcd[3:0] = bin % 10` (0..9)

Implementation: a 20-bit scratch value `{H, T, O, bin}` starts with H = T = O = 0. Eight times: every BCD digit that is >= 5 gets 3 added, then the whole value is shifted left by one. After eight shifts `{H, T, O}` holds the result. Every input value is legal; no digit ever exceeds 9.
## Example
| bin (dec) | bin (hex) | bcd |
|---|---|---|
| 0 | 0x00 | 0x000 |
| 9 | 0x09 | 0x009 |
| 10 | 0x0A | 0x010 |
| 99 | 0x63 | 0x099 |
| 128 | 0x80 | 0x128 |
| 199 | 0xC7 | 0x199 |
| 255 | 0xFF | 0x255 |

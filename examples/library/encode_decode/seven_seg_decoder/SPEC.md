# seven_seg_decoder: hex digit to 7-segment decoder
## Function
Converts a 4-bit hexadecimal digit (0-F) into the segment pattern of a 7-segment display. Segments are active high (1 = segment lit, as for a common-cathode display). Letters are drawn as A, b, C, d, E, F.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| digit | input | 4 | Hex digit 0x0..0xF |
| seg | output | 7 | Segments, bit order seg[6:0] = {g, f, e, d, c, b, a} |
## Behaviour
Purely combinational. Segment naming is the usual one: a = top, b = upper right, c = lower right, d = bottom, e = lower left, f = upper left, g = middle. Bit order: `seg[0] = a`, `seg[1] = b`, `seg[2] = c`, `seg[3] = d`, `seg[4] = e`, `seg[5] = f`, `seg[6] = g`.

A segment is lit for these digits:
- a: 0 2 3 5 6 7 8 9 A C E F
- b: 0 1 2 3 4 7 8 9 A d
- c: 0 1 3 4 5 6 7 8 9 A b d
- d: 0 2 3 5 6 8 9 b C d E
- e: 0 2 6 8 A b C d E F
- f: 0 4 5 6 8 9 A b C E F
- g: 2 3 4 5 6 8 9 A b d E F

Every input value is legal (all 16 have a pattern).
## Example
| digit | seg (gfedcba) | hex |
|---|---|---|
| 0 | 0111111 | 0x3F |
| 1 | 0000110 | 0x06 |
| 2 | 1011011 | 0x5B |
| 7 | 0000111 | 0x07 |
| 8 | 1111111 | 0x7F |
| A | 1110111 | 0x77 |
| b | 1111100 | 0x7C |
| F | 1110001 | 0x71 |

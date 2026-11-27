# crc8_comb: combinational CRC-8 of one byte
## Function
Computes the CRC-8 of a single 8-bit data byte in one combinational step. Polynomial 0x07 (x^8 + x^2 + x + 1), initial value 0x00, data processed MSB first, no input or output reflection, no final XOR.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| data | input | 8 | Data byte |
| crc | output | 8 | CRC-8 of the byte |
## Behaviour
Purely combinational. Mathematically `crc` is the remainder of the polynomial division (over GF(2)) of `data(x) * x^8` by `x^8 + x^2 + x + 1`, where `data[7]` is the coefficient of the highest power.

Bit-serial description: start with `r = 0x00 ^ data`; repeat 8 times: if `r[7] = 1` then `r = (r << 1) ^ 0x07` else `r = r << 1` (8-bit, the shifted-out bit is dropped). Then `crc = r`.

Consequences: `crc(0x00) = 0x00`, and the function is linear: `crc(a ^ b) = crc(a) ^ crc(b)`. Every input value is legal.
## Example
| data | crc |
|---|---|
| 0x00 | 0x00 |
| 0x01 | 0x07 |
| 0x02 | 0x0E |
| 0x31 | 0x97 |
| 0x80 | 0x89 |
| 0xA5 | 0x72 |
| 0xFF | 0xF3 |

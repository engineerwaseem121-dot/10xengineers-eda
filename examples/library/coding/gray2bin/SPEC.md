# gray2bin: Gray code to binary converter
## Function
Converts a reflected binary (Gray) code word back into an unsigned binary number. It is the exact inverse of `bin2gray`. Width is set by a parameter.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Number of bits of input and output (WIDTH >= 1) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| gray | input | WIDTH | Gray-coded value |
| bin | output | WIDTH | Binary value |
## Behaviour
Purely combinational:
- `bin[WIDTH-1] = gray[WIDTH-1]`
- `bin[i] = bin[i+1] ^ gray[i]` for i = WIDTH-2 down to 0

Equivalently `bin[i]` is the XOR of `gray[WIDTH-1:i]`. Every input value is legal, and `gray2bin(bin2gray(x)) = x` for all x.
## Example
WIDTH = 8:

| gray | bin |
|---|---|
| 0x00 | 0x00 |
| 0x01 | 0x01 |
| 0x03 | 0x02 |
| 0x02 | 0x03 |
| 0x04 | 0x07 |
| 0x0C | 0x08 |
| 0xC0 | 0x80 |
| 0x80 | 0xFF |

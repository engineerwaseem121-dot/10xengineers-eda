# bin2gray: binary to Gray code converter
## Function
Converts an unsigned binary number into reflected binary (Gray) code, in which consecutive values differ in exactly one bit. Width is set by a parameter.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Number of bits of input and output (WIDTH >= 1) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| bin | input | WIDTH | Binary value |
| gray | output | WIDTH | Gray-coded value |
## Behaviour
Purely combinational:
- `gray[WIDTH-1] = bin[WIDTH-1]`
- `gray[i] = bin[i+1] ^ bin[i]` for i = 0..WIDTH-2

Equivalently `gray = bin ^ (bin >> 1)`. Every input value is legal.
## Example
WIDTH = 8:

| bin | gray |
|---|---|
| 0x00 | 0x00 |
| 0x01 | 0x01 |
| 0x02 | 0x03 |
| 0x03 | 0x02 |
| 0x07 | 0x04 |
| 0x08 | 0x0C |
| 0x80 | 0xC0 |
| 0xFF | 0x80 |

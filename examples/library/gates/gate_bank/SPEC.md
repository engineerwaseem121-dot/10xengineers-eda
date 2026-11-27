# gate_bank: six bitwise logic gates on two vectors
## Function
Applies AND, OR, XOR, NAND, NOR and XNOR bit by bit to two WIDTH-bit vectors `a` and `b` and presents all six results at once on separate outputs. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Width of the input and output vectors |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | First operand vector |
| b | in | WIDTH | Second operand vector |
| and_o | out | WIDTH | `a & b` |
| or_o | out | WIDTH | `a \| b` |
| xor_o | out | WIDTH | `a ^ b` |
| nand_o | out | WIDTH | `~(a & b)` |
| nor_o | out | WIDTH | `~(a \| b)` |
| xnor_o | out | WIDTH | `~(a ^ b)` |
## Behaviour
For every bit i in 0..WIDTH-1:
- `and_o[i]  = a[i] & b[i]`
- `or_o[i]   = a[i] | b[i]`
- `xor_o[i]  = a[i] ^ b[i]`
- `nand_o[i] = ~(a[i] & b[i])`
- `nor_o[i]  = ~(a[i] | b[i])`
- `xnor_o[i] = ~(a[i] ^ b[i])`

Note `nand_o = ~and_o`, `nor_o = ~or_o`, `xnor_o = ~xor_o`.
## Example
WIDTH = 8:

| a | b | and_o | or_o | xor_o | nand_o | nor_o | xnor_o |
|---|---|---|---|---|---|---|---|
| 8'hF0 | 8'hCC | 8'hC0 | 8'hFC | 8'h3C | 8'h3F | 8'h03 | 8'hC3 |
| 8'h00 | 8'hFF | 8'h00 | 8'hFF | 8'hFF | 8'hFF | 8'h00 | 8'h00 |

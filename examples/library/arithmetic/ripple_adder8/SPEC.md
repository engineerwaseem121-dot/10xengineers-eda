# ripple_adder8: 8-bit ripple-carry adder
## Function
Adds two WIDTH-bit unsigned operands and a carry input. It is built from a chain of WIDTH `full_adder` cells; the carry out of bit i feeds the carry in of bit i+1. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Operand width (number of full_adder cells) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | Operand A |
| b | in | WIDTH | Operand B |
| cin | in | 1 | Carry in to bit 0 |
| sum | out | WIDTH | Sum, `(a + b + cin) mod 2^WIDTH` |
| cout | out | 1 | Carry out of the top bit |
## Behaviour
With c[0] = cin, for each bit i: `sum[i] = a[i] ^ b[i] ^ c[i]`, `c[i+1] = a[i]&b[i] | a[i]&c[i] | b[i]&c[i]`; `cout = c[WIDTH]`.
Overall: `{cout, sum} = a + b + cin` (WIDTH+1-bit result). Unsigned overflow is reported only through `cout`.
## Example
WIDTH = 8:

| a | b | cin | cout | sum |
|---|---|---|---|---|
| 8'h00 | 8'h00 | 0 | 0 | 8'h00 |
| 8'h0F | 8'h01 | 0 | 0 | 8'h10 |
| 8'hFF | 8'h01 | 0 | 1 | 8'h00 |
| 8'h80 | 8'h80 | 1 | 1 | 8'h01 |
| 8'h3C | 8'h55 | 1 | 0 | 8'h92 |

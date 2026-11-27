# abs8: 8-bit signed absolute value
## Function
Returns the magnitude of a signed (two's-complement) WIDTH-bit input. Non-negative inputs pass through; negative inputs are negated. The output is read as **unsigned**, so the most negative input -2^(WIDTH-1) gives 2^(WIDTH-1) exactly (8'h80 = 128 for WIDTH = 8). Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Input and output width |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | Input, signed two's complement |
| y | out | WIDTH | abs(a), unsigned magnitude |
## Behaviour
- If `a[WIDTH-1] == 0`: `y = a`
- If `a[WIDTH-1] == 1`: `y = (~a + 1) mod 2^WIDTH` (two's-complement negation)

There is no overflow output: every magnitude 0..2^(WIDTH-1) fits in an unsigned WIDTH-bit result.
## Example
WIDTH = 8:

| a | value | y |
|---|---|---|
| 8'h00 | 0 | 8'd0 |
| 8'h05 | 5 | 8'd5 |
| 8'hFB | -5 | 8'd5 |
| 8'h7F | 127 | 8'd127 |
| 8'h81 | -127 | 8'd127 |
| 8'h80 | -128 | 8'd128 |

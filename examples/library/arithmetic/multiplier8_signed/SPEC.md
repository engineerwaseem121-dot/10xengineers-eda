# multiplier8_signed: signed 8x8 multiplier
## Function
Multiplies two signed (two's-complement) WIDTH-bit operands and returns the full signed 2*WIDTH-bit product. The product is exact for every input pair, including -128 * -128. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Operand width; product is 2*WIDTH bits |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | Multiplicand, signed two's complement |
| b | in | WIDTH | Multiplier, signed two's complement |
| product | out | 2*WIDTH | `a * b`, signed two's complement |
## Behaviour
`product = signed(a) * signed(b)` in 2*WIDTH bits. Range of inputs is [-2^(WIDTH-1), 2^(WIDTH-1)-1]; the largest magnitude result (-128)*(-128) = 16384 fits, so there is no overflow.
## Example
WIDTH = 8:

| a | b | product |
|---|---|---|
| 8'sd7 | 8'sd6 | 16'sd42 |
| -8'sd3 | 8'sd5 | -16'sd15 (16'hFFF1) |
| -8'sd128 | -8'sd128 | 16'sd16384 (16'h4000) |
| -8'sd128 | 8'sd127 | -16'sd16256 (16'hC080) |
| 8'sd0 | -8'sd1 | 16'sd0 |

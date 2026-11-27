# multiplier4: unsigned 4x4 multiplier
## Function
Multiplies two unsigned WIDTH-bit operands and returns the full 2*WIDTH-bit product, so it can never overflow. Implemented as the sum of partial products `a << i` for every set bit `b[i]`. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 4 | Operand width; product is 2*WIDTH bits |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | Multiplicand (unsigned) |
| b | in | WIDTH | Multiplier (unsigned) |
| product | out | 2*WIDTH | `a * b` (unsigned) |
## Behaviour
`product = sum over i of (b[i] ? (a << i) : 0)` = `a * b`, unsigned, exact (maximum (2^WIDTH-1)^2 fits in 2*WIDTH bits).
## Example
WIDTH = 4:

| a | b | product |
|---|---|---|
| 4'd0 | 4'd9 | 8'd0 |
| 4'd3 | 4'd5 | 8'd15 |
| 4'd7 | 4'd8 | 8'd56 |
| 4'd15 | 4'd15 | 8'd225 |

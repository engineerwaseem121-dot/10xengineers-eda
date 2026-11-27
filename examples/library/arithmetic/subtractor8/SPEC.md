# subtractor8: 8-bit subtractor with borrow
## Function
Subtracts unsigned WIDTH-bit operand `b` from `a`. Outputs the WIDTH-bit difference (wrapping modulo 2^WIDTH) and a borrow flag that is set when `b` is larger than `a`. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Operand width |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | Minuend (unsigned) |
| b | in | WIDTH | Subtrahend (unsigned) |
| diff | out | WIDTH | `(a - b) mod 2^WIDTH` |
| borrow | out | 1 | 1 when `a < b` (unsigned), else 0 |
## Behaviour
- `diff = (a - b) mod 2^WIDTH` (two's-complement wrap when a < b)
- `borrow = (a < b)`

Equivalently `{borrow, diff} = {1'b0, a} - {1'b0, b}` evaluated in WIDTH+1 bits.
## Example
WIDTH = 8:

| a | b | borrow | diff |
|---|---|---|---|
| 8'd10 | 8'd3 | 0 | 8'd7 |
| 8'd3 | 8'd10 | 1 | 8'd249 |
| 8'd0 | 8'd1 | 1 | 8'd255 |
| 8'd200 | 8'd200 | 0 | 8'd0 |

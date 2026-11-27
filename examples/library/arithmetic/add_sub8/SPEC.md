# add_sub8: 8-bit adder/subtractor
## Function
Adds or subtracts two WIDTH-bit operands depending on `mode`. Subtraction is done in two's complement as `a + ~b + 1`, so one adder serves both operations. Outputs the WIDTH-bit result, the adder's carry out and a signed (two's-complement) overflow flag. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Operand width |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | Operand A |
| b | in | WIDTH | Operand B |
| mode | in | 1 | 0 = add, 1 = subtract |
| result | out | WIDTH | `a + b` or `a - b`, modulo 2^WIDTH |
| carry_out | out | 1 | Carry out of the adder's top bit |
| overflow | out | 1 | Signed overflow of the operation |
## Behaviour
Let `b_eff = mode ? ~b : b`. Then `{carry_out, result} = a + b_eff + mode` (WIDTH+1 bits).
- mode = 0: `result = (a + b) mod 2^WIDTH`; `carry_out = 1` when the unsigned sum is >= 2^WIDTH.
- mode = 1: `result = (a - b) mod 2^WIDTH`; `carry_out = 1` when **no borrow** occurs, i.e. `a >= b` unsigned; `carry_out = 0` when `a < b`.
- `overflow = (a[MSB] == b_eff[MSB]) && (result[MSB] != a[MSB])`: 1 exactly when the true signed result (a+b or a-b, operands read as two's complement) lies outside [-2^(WIDTH-1), 2^(WIDTH-1)-1].
## Example
WIDTH = 8:

| a | b | mode | result | carry_out | overflow |
|---|---|---|---|---|---|
| 8'd20 | 8'd22 | 0 | 8'd42 | 0 | 0 |
| 8'hFF | 8'h01 | 0 | 8'h00 | 1 | 0 |
| 8'h7F | 8'h01 | 0 | 8'h80 | 0 | 1 |
| 8'd50 | 8'd8 | 1 | 8'd42 | 1 | 0 |
| 8'd5 | 8'd6 | 1 | 8'hFF | 0 | 0 |
| 8'h80 | 8'h01 | 1 | 8'h7F | 1 | 1 |

# incrementer8: 8-bit incrementer
## Function
Adds one to an unsigned WIDTH-bit value. The result wraps from all-ones to zero, and the carry output flags that wrap. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Operand width |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | Input value (unsigned) |
| y | out | WIDTH | `(a + 1) mod 2^WIDTH` |
| carry | out | 1 | 1 only when a is all ones (result wrapped to 0) |
## Behaviour
`{carry, y} = a + 1` evaluated in WIDTH+1 bits. So `y = a + 1` for `a < 2^WIDTH - 1`; for `a = 2^WIDTH - 1`, `y = 0` and `carry = 1`.
## Example
WIDTH = 8:

| a | y | carry |
|---|---|---|
| 8'h00 | 8'h01 | 0 |
| 8'h0F | 8'h10 | 0 |
| 8'h7F | 8'h80 | 0 |
| 8'hFF | 8'h00 | 1 |

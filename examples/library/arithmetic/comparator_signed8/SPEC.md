# comparator_signed8: 8-bit signed comparator
## Function
Compares two signed (two's-complement) WIDTH-bit numbers and raises exactly one of three flags: equal, less-than or greater-than. Negative numbers compare below positive ones (e.g. 8'hFF = -1 is less than 8'h01 = +1). Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Operand width |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | Operand A, signed two's complement |
| b | in | WIDTH | Operand B, signed two's complement |
| eq | out | 1 | 1 when a == b |
| lt | out | 1 | 1 when a < b (signed) |
| gt | out | 1 | 1 when a > b (signed) |
## Behaviour
With a and b read as two's-complement values in [-2^(WIDTH-1), 2^(WIDTH-1)-1]:
- `eq = (a == b)`
- `lt = (a < b)`
- `gt = (a > b)`

Exactly one of eq, lt, gt is 1 for every input.
## Example
| a | b | eq | lt | gt |
|---|---|---|---|---|
| 8'h05 (5) | 8'h05 (5) | 1 | 0 | 0 |
| 8'hFF (-1) | 8'h01 (1) | 0 | 1 | 0 |
| 8'h7F (127) | 8'h80 (-128) | 0 | 0 | 1 |
| 8'h80 (-128) | 8'hFE (-2) | 0 | 1 | 0 |

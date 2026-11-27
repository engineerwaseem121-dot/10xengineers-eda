# comparator4: 4-bit unsigned comparator
## Function
Compares two unsigned WIDTH-bit numbers and raises exactly one of three flags: equal, less-than or greater-than. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 4 | Operand width |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | Operand A (unsigned) |
| b | in | WIDTH | Operand B (unsigned) |
| eq | out | 1 | 1 when a == b |
| lt | out | 1 | 1 when a < b (unsigned) |
| gt | out | 1 | 1 when a > b (unsigned) |
## Behaviour
- `eq = (a == b)`
- `lt = (a < b)` unsigned
- `gt = (a > b)` unsigned

Exactly one of eq, lt, gt is 1 for every input.
## Example
| a | b | eq | lt | gt |
|---|---|---|---|---|
| 4'd5 | 4'd5 | 1 | 0 | 0 |
| 4'd2 | 4'd9 | 0 | 1 | 0 |
| 4'd15 | 4'd0 | 0 | 0 | 1 |
| 4'd8 | 4'd7 | 0 | 0 | 1 |

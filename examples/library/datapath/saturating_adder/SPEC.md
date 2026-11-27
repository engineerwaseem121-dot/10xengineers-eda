# saturating_adder: unsigned 8-bit saturating adder
## Function
Adds two unsigned 8-bit numbers. If the true sum does not fit in 8 bits, the output clamps to the maximum value 255 instead of wrapping around, and `sat` is raised.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | input | 8 | Unsigned operand A |
| b | input | 8 | Unsigned operand B |
| sum | output | 8 | `min(a + b, 255)` |
| sat | output | 1 | 1 when the true sum exceeded 255 and was clamped |
## Behaviour
Purely combinational, with `s = a + b` computed at full (9-bit) precision:
- `s <= 255`: `sum = s`, `sat = 0`.
- `s > 255`: `sum = 255 (0xFF)`, `sat = 1`.

Note that `a + b = 255` exactly gives `sum = 255` with `sat = 0`. Every input combination is legal.
## Example
| a | b | sum | sat |
|---|---|---|---|
| 10 | 20 | 30 | 0 |
| 200 | 55 | 255 | 0 |
| 200 | 56 | 255 | 1 |
| 255 | 255 | 255 | 1 |
| 0 | 0 | 0 | 0 |

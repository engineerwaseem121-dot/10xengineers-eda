# mod10_counter: synchronous modulo-10 (decade) counter
## Function
Counts 0, 1, ... 9, 0, ... on rising clock edges where `en` is high. All bits change together
(synchronous counter). An asynchronous active-low reset returns it to 0.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | modulus 10, fixed |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| en | in | 1 | Count enable |
| count | out | 4 | Current count, 0..9 |
## Behaviour
- While `rst_n = 0`: `count = 0` immediately.
- Rising edge, `rst_n = 1`, `en = 1`: if `count >= 9` then `count <= 0`, else `count <= count + 1`.
- Rising edge, `en = 0`: hold.
- Values 10..15 are never reached; if they ever appeared (illegal state) the next enabled edge returns to 0.
## Example
| Edge | en | count after edge |
|---|---|---|
| reset | x | 0 |
| 1..9 | 1 | 1..9 |
| 10 | 1 | 0 |
| 11 | 0 | 0 |
| 12 | 1 | 1 |

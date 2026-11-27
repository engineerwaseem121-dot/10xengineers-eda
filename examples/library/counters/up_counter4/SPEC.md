# up_counter4: 4-bit up counter with enable
## Function
A 4-bit binary counter that increments by one on every rising clock edge where `en` is high.
After 15 it wraps to 0. An asynchronous active-low reset clears it.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | 4 bits, fixed |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| en | in | 1 | Count enable |
| count | out | 4 | Current count |
## Behaviour
- While `rst_n = 0`: `count = 0` immediately.
- Rising edge, `rst_n = 1`, `en = 1`: `count <= (count + 1) mod 16` (15 wraps to 0, no flag).
- Rising edge, `en = 0`: `count` holds.
## Example
| Edge | en | count after edge |
|---|---|---|
| reset | x | 0 |
| 1 | 1 | 1 |
| 2 | 1 | 2 |
| 3 | 0 | 2 |
| ... 13 more enabled edges | 1 | 15 |
| next | 1 | 0 (wrap) |

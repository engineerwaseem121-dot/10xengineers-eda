# updown_counter8: 8-bit up/down counter
## Function
An 8-bit counter that adds one (`up = 1`) or subtracts one (`up = 0`) on each enabled rising clock edge.
It wraps modulo 256 in both directions. An asynchronous active-low reset clears it.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | 8 bits, fixed |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| en | in | 1 | Count enable |
| up | in | 1 | Direction: 1 = up, 0 = down |
| count | out | 8 | Current count |
## Behaviour
- While `rst_n = 0`: `count = 0` immediately.
- Rising edge, `en = 1`, `up = 1`: `count <= count + 1` (255 wraps to 0).
- Rising edge, `en = 1`, `up = 0`: `count <= count - 1` (0 wraps to 255).
- Rising edge, `en = 0`: hold (`up` ignored). No overflow/underflow flag.
## Example
| Edge | en | up | count after edge |
|---|---|---|---|
| reset | x | x | 0 |
| 1 | 1 | 0 | 255 |
| 2 | 1 | 1 | 0 |
| 3 | 1 | 1 | 1 |
| 4 | 0 | 0 | 1 |
| 5 | 1 | 0 | 0 |

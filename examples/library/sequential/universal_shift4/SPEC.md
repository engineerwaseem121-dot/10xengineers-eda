# universal_shift4: 4-bit universal shift register
## Function
A 4-bit register whose 2-bit `mode` input chooses, on each rising clock edge, between holding,
shifting left, shifting right or loading `din` in parallel. Separate serial inputs feed the vacated bit.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | 4 bits, fixed |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| mode | in | 2 | Operation select (table below) |
| sl_in | in | 1 | Serial input shifted into `q[0]` on shift left |
| sr_in | in | 1 | Serial input shifted into `q[3]` on shift right |
| din | in | 4 | Parallel load data |
| q | out | 4 | Register contents |
## Behaviour
- While `rst_n = 0`: `q = 4'h0` immediately.
- Rising edge with `rst_n = 1`:

| mode | Operation | next q |
|---|---|---|
| 00 | hold | q |
| 01 | shift left | {q[2:0], sl_in} |
| 10 | shift right | {sr_in, q[3:1]} |
| 11 | parallel load | din |

- Bits shifted out (q[3] on left, q[0] on right) are discarded. Latency 1 clock.
## Example
| Edge | mode | sl_in | sr_in | din | q after edge |
|---|---|---|---|---|---|
| reset | | | | | 0000 |
| 1 | 11 | x | x | 1001 | 1001 |
| 2 | 01 | 1 | x | x | 0011 |
| 3 | 10 | x | 0 | x | 0001 |
| 4 | 10 | x | 1 | x | 1000 |
| 5 | 00 | x | x | x | 1000 |

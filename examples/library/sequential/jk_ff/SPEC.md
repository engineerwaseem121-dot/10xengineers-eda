# jk_ff: JK flip-flop
## Function
A JK flip-flop. On each rising clock edge, `j` and `k` select hold, reset, set or toggle.
An asynchronous active-low reset clears the output.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| j | in | 1 | Set input |
| k | in | 1 | Reset input |
| q | out | 1 | Output |
## Behaviour
- While `rst_n = 0`: `q = 0` immediately.
- Rising edge of `clk` with `rst_n = 1`:

| j | k | next q |
|---|---|---|
| 0 | 0 | q (hold) |
| 0 | 1 | 0 |
| 1 | 0 | 1 |
| 1 | 1 | ~q (toggle) |

- Equivalent equation: `q_next = (j & ~q) | (~k & q)`. Latency 1 clock.
## Example
| Edge | j | k | q after edge |
|---|---|---|---|
| reset | x | x | 0 |
| 1 | 1 | 0 | 1 |
| 2 | 0 | 0 | 1 |
| 3 | 1 | 1 | 0 |
| 4 | 1 | 1 | 1 |
| 5 | 0 | 1 | 0 |

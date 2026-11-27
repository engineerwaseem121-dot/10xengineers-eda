# t_ff: toggle flip-flop
## Function
A T flip-flop. On a rising clock edge with `t = 1` the output inverts; with `t = 0` it holds.
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
| t | in | 1 | Toggle enable |
| q | out | 1 | Output |
## Behaviour
- While `rst_n = 0`: `q = 0` immediately.
- Rising edge of `clk` with `rst_n = 1`: `q <= q ^ t` (toggle when `t = 1`, hold when `t = 0`).
- With `t` held at 1, `q` is a divide-by-2 of `clk`.
## Example
| Edge | t | q after edge |
|---|---|---|
| reset | x | 0 |
| 1 | 1 | 1 |
| 2 | 1 | 0 |
| 3 | 0 | 0 |
| 4 | 1 | 1 |
| 5 | 0 | 1 |

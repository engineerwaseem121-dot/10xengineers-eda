# ram_dp: simple dual-port RAM
## Function
A `DEPTH` x `WIDTH` RAM with an independent write port and read port on the same clock.
A write and a read can happen on the same edge. The read data is registered (one clock latency).
## Parameters
| Name | Default | Meaning |
|---|---|---|
| DEPTH | 16 | Number of words |
| WIDTH | 8 | Bits per word |
| AW | $clog2(DEPTH) | Address width (derived) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active (both ports) |
| rst_n | in | 1 | Asynchronous reset, active low |
| we | in | 1 | Write enable |
| waddr | in | AW | Write address |
| wdata | in | WIDTH | Write data |
| raddr | in | AW | Read address |
| rdata | out | WIDTH | Registered read data |
## Behaviour
- While `rst_n = 0`: all words cleared to 0 and `rdata = 0` immediately.
- Every rising edge with `rst_n = 1`:
  - `rdata <= mem[raddr]` (contents before this edge; a read happens every cycle);
  - if `we = 1`: `mem[waddr] <= wdata`.
- Read latency 1 clock. If `raddr == waddr` with `we = 1` on the same edge, `rdata` gets the OLD word
  (read-first); the new word appears if the address is read again on a later edge.
## Example
| Edge | we | waddr | wdata | raddr | rdata after edge |
|---|---|---|---|---|---|
| 1 | 1 | 2 | 5A | 2 | 00 (old) |
| 2 | 1 | 4 | C3 | 2 | 5A |
| 3 | 0 | x | x | 4 | C3 |
| 4 | 1 | 4 | 11 | 4 | C3 (old) |
| 5 | 0 | x | x | 4 | 11 |

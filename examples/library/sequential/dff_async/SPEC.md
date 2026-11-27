# dff_async: D flip-flop with asynchronous active-low reset
## Function
A single-bit D flip-flop. On every rising clock edge the output `q` takes the value of `d`.
An active-low reset clears `q` immediately, without waiting for the clock.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| d | in | 1 | Data input |
| q | out | 1 | Registered output |
## Behaviour
- While `rst_n = 0`: `q = 0` immediately (asynchronous), regardless of `clk` and `d`.
- On each rising edge of `clk` with `rst_n = 1`: `q <= d`.
- Between edges `q` holds its value. Latency from `d` to `q`: 1 clock.
- Reset value: `q = 0`.
## Example
| Cycle | rst_n | d | q after edge |
|---|---|---|---|
| 0 | 0 | x | 0 |
| 1 | 1 | 1 | 1 |
| 2 | 1 | 0 | 0 |
| 3 | 1 | 1 | 1 |
| mid-cycle | 0 | 1 | 0 (immediately) |

# dff_sync_reset: D flip-flop with synchronous active-high reset
## Function
A single-bit D flip-flop whose reset is sampled on the clock. On a rising edge, `q` is cleared
if `rst` is high, otherwise it takes `d`. Changing `rst` between edges has no effect on `q`.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst | in | 1 | Synchronous reset, active high |
| d | in | 1 | Data input |
| q | out | 1 | Registered output |
## Behaviour
- On each rising edge of `clk`: if `rst = 1` then `q <= 0`, else `q <= d`. `rst` has priority over `d`.
- `rst` is synchronous: asserting it between edges does not change `q` until the next rising edge.
- Latency from `d` (or `rst`) to `q`: 1 clock. Reset value: `q = 0` (after the first edge with `rst = 1`).
- Before the first reset edge `q` is unknown.
## Example
| Edge | rst | d | q after edge |
|---|---|---|---|
| 1 | 1 | 1 | 0 |
| 2 | 0 | 1 | 1 |
| 3 | 1 | 1 | 0 |
| 4 | 0 | 0 | 0 |
| 5 | 0 | 1 | 1 |

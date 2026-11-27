# dff_en: D flip-flop with enable
## Function
A single-bit D flip-flop that only loads `d` on rising clock edges where `en` is high.
When `en` is low the stored value is kept. An asynchronous active-low reset clears it.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| en | in | 1 | Load enable |
| d | in | 1 | Data input |
| q | out | 1 | Registered output |
## Behaviour
- While `rst_n = 0`: `q = 0` immediately. Reset has priority over everything.
- Rising edge of `clk`, `rst_n = 1`, `en = 1`: `q <= d`.
- Rising edge of `clk`, `rst_n = 1`, `en = 0`: `q` keeps its value.
- Latency `d` to `q`: 1 clock (when enabled).
## Example
| Edge | en | d | q after edge |
|---|---|---|---|
| reset | x | x | 0 |
| 1 | 1 | 1 | 1 |
| 2 | 0 | 0 | 1 |
| 3 | 1 | 0 | 0 |
| 4 | 0 | 1 | 0 |

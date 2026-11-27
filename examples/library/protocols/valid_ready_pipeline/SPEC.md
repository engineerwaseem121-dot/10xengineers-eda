# valid_ready_pipeline: two-stage valid/ready pipeline
## Function
Moves data through two register stages using a valid/ready handshake on both sides. The data is not changed. Each stage loads a new item when it is empty or when its current item moves on in the same cycle, so the pipeline sustains one item per cycle; back-pressure from the output propagates combinationally to `in_ready`.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| DATA_W | 8 | Width of the data path |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| in_valid | in | 1 | Input item valid |
| in_ready | out | 1 | Pipeline can take an input item |
| in_data | in | DATA_W | Input item |
| out_valid | out | 1 | Output item valid (stage 2 full) |
| out_ready | in | 1 | Consumer takes the output item |
| out_data | out | DATA_W | Output item |
## Behaviour
- Stages: `v1/d1` (stage 1) and `v2/d2` (stage 2). Reset: `v1 = v2 = 0`, `d1 = d2 = 0`.
- Ready chain (combinational): `rdy2 = !v2 | out_ready`, `rdy1 = !v1 | rdy2`, `in_ready = rdy1`.
- On each rising edge: if `rdy1`, `v1 <= in_valid` and `d1 <= in_data` when `in_valid`; if `rdy2`, `v2 <= v1` and `d2 <= d1` when `v1`. Stages that are not ready hold their contents.
- `out_valid = v2`, `out_data = d2`.
- An input handshake happens on an edge with `in_valid & in_ready`, an output handshake with `out_valid & out_ready`. Latency is 2 cycles: an item accepted at edge k is the output item after edge k+1 and can be taken at edge k+2. With `out_ready` stuck low the pipeline stores two items and then drops `in_ready`. Order is preserved, nothing is lost or duplicated.
## Example
| Edge | in_valid / in_data | out_ready | v1/d1 after | v2/d2 after | in_ready after |
|---|---|---|---|---|---|
| 1 | 1 / A | 1 | 1/A | 0 | 1 |
| 2 | 1 / B | 1 | 1/B | 1/A | 1 |
| 3 | 1 / C | 0 | 1/B | 1/A | 0 |
| 4 | 1 / C | 1 | 1/C | 1/B | 1 |

# seq_detector_1011_moore: overlapping 1011 sequence detector (Moore)
## Function
Watches a serial bit stream `din`, sampled on each rising clock edge, and raises `detected` when the last four sampled bits were 1, 0, 1, 1 (oldest first). Overlapping occurrences are detected: the tail of one match can start the next. The output depends only on the state (Moore), so it is high for the whole cycle after the edge that sampled the final `1`.
## Parameters
None.
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| din | in | 1 | Serial input bit, sampled on rising edge |
| detected | out | 1 | High while the FSM is in state S_1011 |
## Behaviour
States (enum `state_t`): `S_IDLE` (no prefix seen), `S_1`, `S_10`, `S_101`, `S_1011` (match). Reset → `S_IDLE`.

| State | din=0 | din=1 | detected |
|---|---|---|---|
| S_IDLE | S_IDLE | S_1 | 0 |
| S_1 | S_10 | S_1 | 0 |
| S_10 | S_IDLE | S_101 | 0 |
| S_101 | S_10 | S_1011 | 0 |
| S_1011 | S_10 | S_1 | 1 |

Equivalent rule: after the rising edge that samples bit k (k ≥ 4 bits since reset), `detected` = 1 exactly when bits k−3..k were 1,0,1,1. Latency: one cycle (registered state, output decoded from state). There are no illegal inputs.
## Example
| Edge # | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| din sampled | 1 | 0 | 1 | 1 | 0 | 1 | 1 |
| detected after edge | 0 | 0 | 0 | 1 | 0 | 0 | 1 |

The second match (edges 4–7) reuses the final `1` of the first match.

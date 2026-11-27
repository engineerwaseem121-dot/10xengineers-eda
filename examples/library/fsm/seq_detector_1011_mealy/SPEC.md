# seq_detector_1011_mealy: overlapping 1011 sequence detector (Mealy)
## Function
Watches a serial bit stream `din` and raises `detected` combinationally in the cycle in which the final `1` of the pattern 1, 0, 1, 1 is present on `din`, given that the three previously sampled bits were 1, 0, 1. Overlapping occurrences are detected. Because the output is Mealy it appears one cycle earlier than in the Moore version and needs one fewer state.
## Parameters
None.
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| din | in | 1 | Serial input bit, sampled on rising edge |
| detected | out | 1 | Combinational: `state == S_101 && din` |
## Behaviour
States (enum `state_t`): `S_IDLE`, `S_1`, `S_10`, `S_101`. Reset → `S_IDLE`.

| State | din=0 → next / detected | din=1 → next / detected |
|---|---|---|
| S_IDLE | S_IDLE / 0 | S_1 / 0 |
| S_1 | S_10 / 0 | S_1 / 0 |
| S_10 | S_IDLE / 0 | S_101 / 0 |
| S_101 | S_10 / 0 | S_1 / **1** |

Equivalent rule: while bit k is on `din` (before the edge that samples it), `detected` = 1 exactly when the previously sampled bits k−3..k−1 were 1,0,1 and `din` = 1. `detected` follows `din` combinationally, so it can glitch if `din` changes mid-cycle; register it externally if a clean pulse is needed.
## Example
| Cycle | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| din | 1 | 0 | 1 | 1 | 0 | 1 | 1 |
| detected (same cycle) | 0 | 0 | 0 | 1 | 0 | 0 | 1 |

# debouncer: input debouncer with stability counter
## Function
Filters a noisy single-bit input. `dout` only changes to the value of `din` after `din` has been sampled
at that new value on `STABLE_CYCLES` consecutive rising clock edges. Any shorter pulse or bounce is ignored.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| STABLE_CYCLES | 4 | Number of consecutive samples (>= 1) the new value must be seen before `dout` follows |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| din | in | 1 | Raw input (assumed synchronous to `clk`; add a synchronizer outside if not) |
| dout | out | 1 | Debounced output |
## Behaviour
- Internal counter `cnt` (width `max(1, clog2(STABLE_CYCLES))`).
- While `rst_n = 0`: `dout = 0`, `cnt = 0` immediately.
- Rising edge with `rst_n = 1`:
  - if `din == dout`: `cnt <= 0` (input agrees with output, nothing pending);
  - else if `cnt == STABLE_CYCLES-1`: `dout <= din`, `cnt <= 0`;
  - else: `cnt <= cnt + 1`.
- So `dout` changes at the `STABLE_CYCLES`-th consecutive edge on which `din != dout`. If `din` returns to
  the `dout` value on any edge before that, the count restarts from zero.
- Latency of a clean change: `STABLE_CYCLES` edges (the change is visible right after the
  `STABLE_CYCLES`-th edge that sampled the new value).
## Example
STABLE_CYCLES = 4, after reset (`dout = 0`):

| Edge | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| din | 1 | 1 | 0 | 1 | 1 | 1 | 1 | 0 | 0 | 1 |
| dout after edge | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 |

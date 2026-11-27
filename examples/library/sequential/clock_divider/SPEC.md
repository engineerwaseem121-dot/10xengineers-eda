# clock_divider: even clock divider, 50% duty cycle
## Function
Produces `clk_out` with a frequency of `clk / DIV`. A counter counts `DIV/2` input clock edges,
then `clk_out` toggles, so the output is high for `DIV/2` input cycles and low for `DIV/2` input cycles.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| DIV | 4 | Division ratio. Must be even and >= 2. Output period = DIV input periods |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Input clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| clk_out | out | 1 | Divided clock (registered, changes just after a rising edge of `clk`) |
## Behaviour
- Internal counter `cnt` counts 0 .. DIV/2-1.
- While `rst_n = 0`: `cnt = 0`, `clk_out = 0` immediately.
- Rising edge with `rst_n = 1`: if `cnt == DIV/2 - 1` then `cnt <= 0` and `clk_out <= ~clk_out`; else `cnt <= cnt + 1`.
- First toggle (0 to 1) happens on the DIV/2-th rising edge after reset release, then every DIV/2 edges.
- Duty cycle: exactly 50% (DIV/2 cycles high, DIV/2 cycles low). Odd DIV is not supported
  (it behaves like DIV-1).
## Example
DIV = 4, after reset:

| Edge | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| clk_out after edge | 0 | 1 | 1 | 0 | 0 | 1 | 1 | 0 |

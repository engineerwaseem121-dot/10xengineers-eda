# pwm_gen: 8-bit pulse-width modulator
## Function
Generates a pulse-width-modulated signal with a fixed period of 256 clock cycles. In each period `pwm` is high for `duty` cycles and low for the remaining 256 − `duty` cycles. The duty value is sampled once per period, at the period boundary, so changing `duty` never produces a glitch or a shortened pulse.
## Parameters
None (8-bit resolution, period 256).
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| duty | in | 8 | Requested high time per period (0 = always low, 255 = high 255 of 256 cycles) |
| pwm | out | 1 | PWM output |
## Behaviour
- Registers: free-running 8-bit counter `cnt`, latched duty `duty_q`.
- Reset: `cnt = 0`, `duty_q = 0` → `pwm = 0` for the whole first period after reset.
- Each rising edge: `cnt <= cnt + 1` (wraps 255 → 0). When `cnt == 255`, `duty_q <= duty` (the value present in the last cycle of a period is used for the next period).
- Output (combinational from registers): `pwm = (cnt < duty_q)`. A period starts at `cnt = 0` with `pwm` high (if `duty_q > 0`) and the falling edge comes after `duty_q` cycles. 100 % duty is not reachable; duty 0 gives a constant 0.
## Example
| Period | duty during last cycle of previous period | pwm high cycles (cnt) |
|---|---|---|
| 1 (after reset) | – | 0 |
| 2 | 128 | cnt 0..127 high, 128..255 low |
| 3 | 255 | cnt 0..254 high, 255 low |
| 4 | 1 | cnt 0 high only |

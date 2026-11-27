# edge_detector: rising/falling edge detector
## Function
Samples `sig` on every rising clock edge and compares it with the sample from the previous edge.
A 0-to-1 change produces a one-clock pulse on `rise`; a 1-to-0 change produces a one-clock pulse on `fall`.
Both outputs are registered.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| sig | in | 1 | Input to watch (assumed synchronous to `clk`) |
| rise | out | 1 | One-cycle pulse after a 0-to-1 change of `sig` |
| fall | out | 1 | One-cycle pulse after a 1-to-0 change of `sig` |
## Behaviour
- Internal register `sig_d` holds the previous sample.
- While `rst_n = 0`: `sig_d = 0`, `rise = 0`, `fall = 0` immediately.
- Rising edge with `rst_n = 1`:
  - `rise <= sig & ~sig_d`
  - `fall <= ~sig & sig_d`
  - `sig_d <= sig`
- Latency: if `sig` is first sampled 1 at edge N (and was 0 at edge N-1), `rise = 1` from edge N to edge N+1,
  exactly one clock. `rise` and `fall` are never 1 together.
- Because `sig_d` resets to 0, a `sig` that is already 1 when reset is released gives one `rise` pulse
  on the first edge.
## Example
| Edge | sig | rise after edge | fall after edge |
|---|---|---|---|
| 1 | 0 | 0 | 0 |
| 2 | 1 | 1 | 0 |
| 3 | 1 | 0 | 0 |
| 4 | 0 | 0 | 1 |
| 5 | 0 | 0 | 0 |
| 6 | 1 | 1 | 0 |

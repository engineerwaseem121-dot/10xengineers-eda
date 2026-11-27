# siso_shift: 8-stage serial-in serial-out shift register
## Function
An 8-bit shift register that shifts one position on every rising clock edge.
`sin` enters stage 0 and `sout` is the last stage, so `sout` repeats `sin` delayed by 8 clocks.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | 8 stages, fixed |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| sin | in | 1 | Serial input |
| sout | out | 1 | Serial output (stage 7) |
## Behaviour
- Internal stages `sr[7:0]`. While `rst_n = 0`: `sr = 8'h00` (so `sout = 0`) immediately.
- Every rising edge with `rst_n = 1`: `sr <= {sr[6:0], sin}` (no enable, shifts every cycle).
- `sout = sr[7]` (combinational from the register).
- Latency: the value of `sin` sampled at edge N appears on `sout` after edge N+7, i.e. 8 edges in total
  counting edge N. After reset, `sout` outputs 0 for the first 7 edges.
## Example
`sin` = 1 at edge 1 only, then 0:

| After edge | 1 | 2..7 | 8 | 9 |
|---|---|---|---|---|
| sout | 0 | 0 | 1 | 0 |

# sipo_shift: 8-bit serial-in parallel-out shift register
## Function
Shifts `sin` into an 8-bit register on every rising clock edge and exposes all 8 stages on `pout`.
New bits enter at bit 0 and move toward bit 7, so after 8 clocks `pout[7]` holds the oldest bit.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | 8 bits, fixed |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| sin | in | 1 | Serial input |
| pout | out | 8 | Parallel output (register contents) |
## Behaviour
- While `rst_n = 0`: `pout = 8'h00` immediately.
- Every rising edge with `rst_n = 1`: `pout <= {pout[6:0], sin}` (no enable).
- After 8 edges with bits b0 (first), b1, ... b7 (last): `pout = {b0, b1, b2, b3, b4, b5, b6, b7}`,
  i.e. the first bit shifted in ends at the MSB.
## Example
`sin` sequence 1,0,1,1,0,0,1,0 on edges 1..8 after reset:

| After edge | 1 | 2 | 3 | 4 | 8 |
|---|---|---|---|---|---|
| pout | 01 | 02 | 05 | 0B | B2 |

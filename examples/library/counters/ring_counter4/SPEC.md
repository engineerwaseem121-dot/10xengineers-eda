# ring_counter4: 4-bit one-hot ring counter
## Function
A 4-bit shift register whose last bit feeds back to the first, holding a single 1 that rotates one position
on every rising clock edge. It cycles through 4 one-hot states.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | 4 bits, fixed |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| q | out | 4 | One-hot state |
## Behaviour
- While `rst_n = 0`: `q = 4'b0001` immediately.
- Every rising edge with `rst_n = 1`: `q <= {q[2:0], q[3]}` (rotate left; no enable).
- Sequence: 0001 -> 0010 -> 0100 -> 1000 -> 0001 ... period 4.
- The design does not self-correct: only reset establishes the one-hot pattern.
## Example
| After edge | reset | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| q | 0001 | 0010 | 0100 | 1000 | 0001 | 0010 |

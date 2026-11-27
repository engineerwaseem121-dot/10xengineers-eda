# johnson_counter4: 4-bit Johnson counter
## Function
A 4-bit shift register whose inverted last bit feeds the first bit (twisted ring).
It steps through 8 states, filling with ones and then with zeros, one bit per clock.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | 4 bits, fixed |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| q | out | 4 | Counter state |
## Behaviour
- While `rst_n = 0`: `q = 4'b0000` immediately.
- Every rising edge with `rst_n = 1`: `q <= {q[2:0], ~q[3]}` (no enable).
- Sequence (period 8): 0000, 0001, 0011, 0111, 1111, 1110, 1100, 1000, 0000 ...
- Only these 8 of the 16 codes are reachable from reset; the design does not self-correct from the others.
## Example
| After edge | reset | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| q | 0000 | 0001 | 0011 | 0111 | 1111 | 1110 | 1100 | 1000 | 0000 |

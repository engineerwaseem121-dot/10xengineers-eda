# lfsr8: 8-bit Fibonacci LFSR
## Function
An 8-bit maximal-length linear feedback shift register (Fibonacci form) with taps 8, 6, 5, 4
(polynomial x^8 + x^6 + x^5 + x^4 + 1). It shifts left one position per enabled clock edge and
visits all 255 non-zero states before repeating.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | 8 bits, taps and seed fixed |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| en | in | 1 | Shift enable |
| q | out | 8 | LFSR state |
## Behaviour
- Tap n is bit n-1: feedback `fb = q[7] ^ q[5] ^ q[4] ^ q[3]`.
- While `rst_n = 0`: `q = 8'h01` (seed) immediately.
- Rising edge, `en = 1`: `q <= {q[6:0], fb}`.
- Rising edge, `en = 0`: hold.
- Period 255. The all-zero state is never reached from the seed (it would lock up; only reachable by fault).
## Example
| After enabled edge | reset | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| q (hex) | 01 | 02 | 04 | 08 | 11 | 23 | 47 | 8E | 1C | 38 |

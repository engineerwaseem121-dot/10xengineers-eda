# gray_counter: Gray-code counter
## Function
A `WIDTH`-bit counter whose output `gray` steps through the reflected binary Gray code, so exactly one
output bit changes per enabled clock edge. Internally it keeps a binary count and registers its Gray conversion.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 4 | Counter width in bits (>= 2) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| en | in | 1 | Count enable |
| gray | out | WIDTH | Gray-coded count (registered) |
## Behaviour
- Internal binary register `bin`. While `rst_n = 0`: `bin = 0`, `gray = 0` immediately.
- Rising edge, `en = 1`: `bin <= bin + 1` (mod 2^WIDTH) and `gray <= (bin+1) ^ ((bin+1) >> 1)`.
- Rising edge, `en = 0`: both hold.
- At all times `gray == bin ^ (bin >> 1)`. Consecutive outputs differ in exactly one bit, including the wrap
  from the last code back to 0 (period 2^WIDTH).
## Example
WIDTH = 4, `en = 1`:

| After edge | reset | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 15 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gray | 0000 | 0001 | 0011 | 0010 | 0110 | 0111 | 0101 | 0100 | 1100 | 1000 | 0000 |

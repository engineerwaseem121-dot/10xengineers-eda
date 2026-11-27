# mac_unit: signed multiply-accumulate unit
## Function
Multiplies two signed 8-bit operands and adds the 16-bit product to a signed 20-bit accumulator on every enabled clock cycle. A synchronous `clear` empties the accumulator. The accumulator wraps around (two's complement) on overflow.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | input | 1 | Clock, rising edge |
| rst_n | input | 1 | Asynchronous reset, active low |
| clear | input | 1 | Synchronous clear of the accumulator |
| en | input | 1 | Accumulate `a * b` this cycle |
| a | input | 8 | Signed operand A (two's complement, -128..127) |
| b | input | 8 | Signed operand B (two's complement, -128..127) |
| acc | output | 20 | Signed accumulator (two's complement) |
## Behaviour
- `rst_n = 0` (asynchronous, any time): `acc = 0`.
- On each rising edge of `clk` with `rst_n = 1`, in priority order:
  1. `clear = 1`: `acc <= 0` (`en`, `a`, `b` ignored).
  2. else `en = 1`: `acc <= (acc + a * b) mod 2^20`, where `a * b` is the exact signed product (-16256..16384) sign-extended to 20 bits; the sum wraps in 20-bit two's complement.
  3. else: `acc` holds.
- Latency: the product of the inputs present at a rising edge is visible on `acc` right after that edge (1 cycle).
- Overflow: no saturation. The accumulator range is -524288..524287; starting from 0 it takes 32 back-to-back products of +16384 (-128 x -128) to overflow (16384 x 32 = 524288 wraps to -524288).
## Example
| Cycle | clear | en | a | b | acc after the edge |
|---|---|---|---|---|---|
| reset | - | - | - | - | 0 |
| 1 | 0 | 1 | 3 | 4 | 12 |
| 2 | 0 | 1 | -2 | 5 | 2 |
| 3 | 0 | 0 | 100 | 100 | 2 |
| 4 | 0 | 1 | -128 | -128 | 16386 |
| 5 | 1 | 1 | 7 | 7 | 0 |
| 6 | 0 | 1 | 127 | -128 | -16256 |

# program_counter: 32-bit program counter
## Function
Holds the address of the current instruction. Each clock it either jumps to an absolute address (`load`),
adds a signed offset (`branch`), steps to the next 4-byte instruction (`en`), or holds.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| RESET_VECTOR | 32'h0000_0000 | Value of `pc` after reset |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| en | in | 1 | Increment enable (pc + 4) |
| load | in | 1 | Absolute jump: load `load_addr` |
| load_addr | in | 32 | Jump target |
| branch | in | 1 | Relative branch: add `offset` |
| offset | in | 32 | Signed (two's complement) branch offset in bytes |
| pc | out | 32 | Program counter |
## Behaviour
- While `rst_n = 0`: `pc = RESET_VECTOR` immediately.
- Rising edge with `rst_n = 1`, priority from highest to lowest:
  1. `load = 1`: `pc <= load_addr`
  2. else `branch = 1`: `pc <= pc + offset` (mod 2^32; a negative offset moves backwards)
  3. else `en = 1`: `pc <= pc + 4` (mod 2^32)
  4. else: hold
- Arithmetic wraps modulo 2^32 with no flag. No alignment check is made on `load_addr` or `offset`.
- Latency 1 clock.
## Example
| Edge | load | load_addr | branch | offset | en | pc after edge |
|---|---|---|---|---|---|---|
| reset | | | | | | 0000_0000 |
| 1 | 0 | | 0 | | 1 | 0000_0004 |
| 2 | 0 | | 0 | | 1 | 0000_0008 |
| 3 | 0 | | 1 | FFFF_FFF8 (-8) | 1 | 0000_0000 |
| 4 | 1 | 0000_1000 | 1 | 10 | 1 | 0000_1000 |
| 5 | 0 | | 1 | 0000_0010 | 0 | 0000_1010 |
| 6 | 0 | | 0 | | 0 | 0000_1010 |

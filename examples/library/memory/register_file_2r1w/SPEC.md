# register_file_2r1w: 8 x 8-bit register file, 2 read / 1 write ports
## Function
Eight 8-bit registers with two asynchronous (combinational) read ports and one synchronous write port,
in the RISC-V style: register 0 always reads as zero and writes to it are ignored.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | 8 registers x 8 bits, fixed |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active (write port) |
| rst_n | in | 1 | Asynchronous reset, active low |
| ra1 | in | 3 | Read address, port 1 |
| ra2 | in | 3 | Read address, port 2 |
| rd1 | out | 8 | Read data, port 1 (combinational) |
| rd2 | out | 8 | Read data, port 2 (combinational) |
| we | in | 1 | Write enable |
| wa | in | 3 | Write address |
| wd | in | 8 | Write data |
## Behaviour
- While `rst_n = 0`: registers 1..7 are cleared to 0 immediately.
- Rising edge with `rst_n = 1`: if `we = 1` and `wa != 0`, `reg[wa] <= wd`. A write to register 0 is ignored.
- Reads are combinational: `rd1 = (ra1 == 0) ? 0 : reg[ra1]`, `rd2 = (ra2 == 0) ? 0 : reg[ra2]`.
  Both ports may read the same register.
- No write-to-read bypass: reading the register being written returns the old value until the rising edge,
  and the new value just after it.
## Example
| Step | we | wa | wd | ra1 | ra2 | rd1 | rd2 |
|---|---|---|---|---|---|---|---|
| after reset | 0 | | | 1 | 2 | 00 | 00 |
| edge 1 | 1 | 1 | 3C | 1 | 0 | 3C | 00 |
| edge 2 | 1 | 0 | FF | 0 | 1 | 00 | 3C |
| edge 3 | 1 | 7 | 81 | 7 | 7 | 81 | 81 |

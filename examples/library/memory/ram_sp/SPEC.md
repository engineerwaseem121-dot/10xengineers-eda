# ram_sp: single-port synchronous RAM
## Function
A `DEPTH` x `WIDTH` RAM with one address port shared by reads and writes. Writes happen on the rising clock
edge when `we` is high. The read data is registered: `dout` shows the word at `addr` one clock after the address
is presented. A read of the address being written returns the old contents (read-first).
## Parameters
| Name | Default | Meaning |
|---|---|---|
| DEPTH | 16 | Number of words |
| WIDTH | 8 | Bits per word |
| AW | $clog2(DEPTH) | Address width (derived) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| addr | in | AW | Read/write address |
| we | in | 1 | Write enable |
| din | in | WIDTH | Write data |
| dout | out | WIDTH | Registered read data |
## Behaviour
- While `rst_n = 0`: every word is cleared to 0 and `dout = 0` immediately.
- Every rising edge with `rst_n = 1` (no read enable, a read happens every cycle):
  - `dout <= mem[addr]` using the contents from before this edge;
  - if `we = 1`: `mem[addr] <= din`.
- Read latency: 1 clock. Read-during-write to the same address: `dout` gets the OLD word; the new word is
  visible on the next read.
- `addr` is always in range for the default DEPTH (power of two).
## Example
| Edge | addr | we | din | dout after edge |
|---|---|---|---|---|
| 1 | 3 | 1 | AA | 00 (old) |
| 2 | 3 | 1 | BB | AA (old) |
| 3 | 3 | 0 | x | BB |
| 4 | 5 | 0 | x | 00 |

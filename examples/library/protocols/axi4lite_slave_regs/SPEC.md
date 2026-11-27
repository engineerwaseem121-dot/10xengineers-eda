# axi4lite_slave_regs: AXI4-Lite slave with four 32-bit registers
## Function
An AXI4-Lite subordinate with four 32-bit read/write registers at byte offsets 0x0, 0x4, 0x8 and 0xC. It implements all five channels (write address AW, write data W, write response B, read address AR, read data R) with valid/ready handshakes. AW and W are captured independently and may arrive in either order or together; byte strobes select which bytes are written. Accesses outside the register block get a SLVERR response.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| ADDR_W | 8 | Width of `awaddr` / `araddr` (≥ 4) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| aclk | in | 1 | Clock, rising edge |
| aresetn | in | 1 | Asynchronous active-low reset |
| awaddr | in | ADDR_W | Write address |
| awprot | in | 3 | Protection type (accepted, ignored) |
| awvalid / awready | in / out | 1 | Write address handshake |
| wdata | in | 32 | Write data |
| wstrb | in | 4 | Byte strobes, bit i enables `wdata[8i+7:8i]` |
| wvalid / wready | in / out | 1 | Write data handshake |
| bresp | out | 2 | Write response: 00 OKAY, 10 SLVERR |
| bvalid / bready | out / in | 1 | Write response handshake |
| araddr | in | ADDR_W | Read address |
| arprot | in | 3 | Protection type (accepted, ignored) |
| arvalid / arready | in / out | 1 | Read address handshake |
| rdata | out | 32 | Read data |
| rresp | out | 2 | Read response: 00 OKAY, 10 SLVERR |
| rvalid / rready | out / in | 1 | Read data handshake |
## Behaviour
Register map (all RW, reset 0x0000_0000): 0x0 REG0, 0x4 REG1, 0x8 REG2, 0xC REG3. An address is mapped when `addr[ADDR_W-1:4] == 0`; `addr[3:2]` selects the register and `addr[1:0]` is ignored. Any other address is unmapped.

A handshake on a channel happens on a rising edge where both valid and ready are 1.

Write path:
- `awready = !aw_full`, `wready = !w_full`. An AW handshake stores the address and sets `aw_full`; a W handshake stores `wdata`/`wstrb` and sets `w_full`. Either may come first, or both in the same cycle.
- On the first rising edge where `aw_full & w_full & !bvalid`: the write is performed (for a mapped address the bytes with `wstrb[i] = 1` replace the matching bytes of the register; for an unmapped address nothing changes), `bvalid <= 1`, `bresp <= OKAY` (mapped) or `SLVERR` (unmapped), and both holding registers are emptied so new AW/W can be accepted from the next cycle.
- `bvalid` and `bresp` stay stable until the B handshake (`bvalid & bready`), after which `bvalid <= 0`. While `bvalid` is high, at most one further AW and one W are buffered; the next write is performed after the B handshake.
- Minimum write: AW and W handshake at edge 0, write and `bvalid` after edge 1, B handshake at edge 2 when `bready` is high.

Read path:
- `arready = !rvalid`. On an AR handshake: `rvalid <= 1`, `rdata <=` the selected register (0 when unmapped), `rresp <= OKAY` or `SLVERR`. `rvalid`, `rdata`, `rresp` hold until the R handshake, then `rvalid <= 0`. One read is outstanding at a time; read latency is one cycle.
- Reads and writes are independent; a read in the same cycle as a write to the same register returns the old value.

Reset: all registers 0, `bvalid = rvalid = 0`, both holding registers empty (`awready = wready = arready = 1`).
## Example
| Edge | Channel activity | Result |
|---|---|---|
| 1 | W handshake (wdata 0xAABBCCDD, wstrb 0101) | W buffered |
| 3 | AW handshake (awaddr 0x8) | AW buffered |
| 4 | – | REG2 = 0x00BB00DD (from 0), bvalid = 1, bresp = OKAY |
| 5 | B handshake | bvalid = 0 |
| 6 | AR handshake (araddr 0x8) | rvalid = 1, rdata = 0x00BB00DD, rresp = OKAY |
| 7 | R handshake | rvalid = 0 |
| 8 | AR handshake (araddr 0x24) | rdata = 0, rresp = SLVERR |

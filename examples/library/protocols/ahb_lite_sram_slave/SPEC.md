# ahb_lite_sram_slave: AHB-Lite slave with 16 x 32-bit memory
## Function
A zero-wait-state AHB-Lite memory slave holding 16 words of 32 bits. It follows the pipelined AHB-Lite transfer: the address and control of a transfer are captured on the rising edge that ends its address phase, and the data moves during the following cycle (the data phase), which overlaps the address phase of the next transfer. Byte, halfword and word writes are supported; reads always return the full word.
## Parameters
None (16 words; addresses alias every 64 bytes).
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| hclk | in | 1 | Bus clock, rising edge |
| hresetn | in | 1 | Asynchronous active-low reset |
| hsel | in | 1 | Slave select (address phase) |
| haddr | in | 32 | Byte address (address phase); bits [5:2] select the word |
| htrans | in | 2 | Transfer type: 00 IDLE, 01 BUSY, 10 NONSEQ, 11 SEQ |
| hwrite | in | 1 | 1 = write, 0 = read |
| hsize | in | 3 | 0 = byte, 1 = halfword, 2 = word (≥ 3 treated as word) |
| hwdata | in | 32 | Write data (data phase) |
| hrdata | out | 32 | Read data (data phase) |
| hready | out | 1 | Transfer done; always 1 (no wait states) |
| hresp | out | 1 | Response; always 0 (OKAY) |
## Behaviour
- Reset: all 16 words = 0, no transfer in data phase, `hrdata = 0`.
- Address phase: a transfer is active when `hsel = 1` and `htrans` is NONSEQ or SEQ. On the rising edge, the slave registers `dp_valid = active`, and for an active transfer `dp_write = hwrite`, `dp_index = haddr[5:2]` and the byte-lane mask: byte → lane `haddr[1:0]`; halfword → lanes 1:0 if `haddr[1] = 0` else 3:2; word → all lanes. IDLE and BUSY transfers, or `hsel = 0`, produce no data phase. Upper address bits [31:6] are ignored.
- Data phase (the cycle after the address phase):
  - Write: on the rising edge ending the data phase, the selected byte lanes of `mem[dp_index]` take the same lanes of `hwdata` (little endian, data on the lanes given by the address); other lanes keep their value.
  - Read: `hrdata = mem[dp_index]` combinationally during the data phase; otherwise `hrdata = 0`.
- A read whose address phase coincides with the data phase of a write to the same word returns the newly written data (the write completes on the edge that starts the read's data phase).
- `hready = 1`, `hresp = 0` at all times: every transfer completes in one data-phase cycle with an OKAY response; there are no error responses.
## Example
| Cycle | Address phase (hsel, htrans, hwrite, haddr, hsize) | Data phase | hwdata | hrdata |
|---|---|---|---|---|
| 1 | 1, NONSEQ, W, 0x04, word | – | – | 0 |
| 2 | 1, NONSEQ, W, 0x09, byte | write 0x04 | 0xCAFE0001 | 0 |
| 3 | 1, NONSEQ, R, 0x04, word | write 0x09 lane 1 | 0x0000AB00 | 0 |
| 4 | 1, IDLE | read 0x04 | – | 0xCAFE0001 |
| 5 | 1, NONSEQ, R, 0x08, word | – | – | 0 |
| 6 | 0 | read 0x08 | – | 0x0000AB00 |

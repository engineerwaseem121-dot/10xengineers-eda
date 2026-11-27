# wishbone_slave_regs: Wishbone B4 classic slave with four 32-bit registers
## Function
A Wishbone B4 classic-cycle slave holding four 32-bit read/write registers selected by a 2-bit word address. Each request is acknowledged with a registered `ack_o` exactly one cycle after the slave first sees the strobe, and `ack_o` lasts a single cycle. Byte selects choose which bytes a write updates.
## Parameters
None.
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk_i | in | 1 | Clock, rising edge |
| rst_i | in | 1 | Synchronous active-high reset |
| cyc_i | in | 1 | Bus cycle in progress |
| stb_i | in | 1 | Strobe: a transfer is requested |
| we_i | in | 1 | 1 = write, 0 = read |
| adr_i | in | 2 | Word address (register index 0..3) |
| dat_i | in | 32 | Write data |
| sel_i | in | 4 | Byte selects, bit i enables `dat_i[8i+7:8i]` |
| dat_o | out | 32 | Read data (registered, valid while `ack_o` = 1) |
| ack_o | out | 1 | Transfer acknowledge (one cycle) |
## Behaviour
Register map (all RW, reset 0): adr_i = 0 REG0, 1 REG1, 2 REG2, 3 REG3. There are no unmapped addresses and no error/retry signals.

- `req = cyc_i & stb_i & !ack_o`.
- On a rising edge with `rst_i = 1`: all registers, `dat_o` and `ack_o` become 0.
- Otherwise on each rising edge: `ack_o <= req`. If `req`:
  - write (`we_i = 1`): bytes of register `adr_i` with `sel_i[i] = 1` take the matching bytes of `dat_i`; `dat_o` unchanged.
  - read (`we_i = 0`): `dat_o <=` register `adr_i` (all 32 bits, `sel_i` ignored).
- The master holds `cyc_i`, `stb_i`, `we_i`, `adr_i`, `dat_i`, `sel_i` until it sees `ack_o`; the transfer ends on the rising edge where `stb_i & ack_o`. Because of the `!ack_o` term the slave never acts twice on one request. If the master keeps `stb_i` high for a new transfer right after an acknowledge, that transfer is acknowledged two cycles later (one idle cycle in between).
- `stb_i` without `cyc_i` is ignored.
## Example
| Cycle | cyc_i | stb_i | we_i | adr_i | dat_i | sel_i | ack_o | dat_o |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 1 | 1 | 2 | 0x12345678 | 0011 | 0 | – |
| 2 | 1 | 1 | 1 | 2 | 0x12345678 | 0011 | 1 | – (REG2 = 0x00005678) |
| 3 | 1 | 1 | 0 | 2 | – | – | 0 | – |
| 4 | 1 | 1 | 0 | 2 | – | – | 1 | 0x00005678 |
| 5 | 0 | 0 | – | – | – | – | 0 | 0x00005678 |

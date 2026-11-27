# apb_slave_regs: APB slave with four 32-bit registers
## Function
An APB completer holding four 32-bit read/write registers at byte offsets 0x0, 0x4, 0x8 and 0xC. Every transfer completes without wait states (`pready` is tied high). Accesses to any other offset (including unaligned offsets) are answered with an error response in the access phase and have no effect.
## Parameters
None.
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| pclk | in | 1 | APB clock, rising edge |
| presetn | in | 1 | Asynchronous active-low reset |
| psel | in | 1 | Slave select (setup and access phase) |
| penable | in | 1 | High in the access phase |
| pwrite | in | 1 | 1 = write, 0 = read |
| paddr | in | 8 | Byte address |
| pwdata | in | 32 | Write data |
| prdata | out | 32 | Read data (combinational) |
| pready | out | 1 | Always 1 |
| pslverr | out | 1 | Error response, valid in the access phase |
## Behaviour
Register map (reset value of all registers 0x0000_0000):

| Offset | Name | Access |
|---|---|---|
| 0x0 | REG0 | RW |
| 0x4 | REG1 | RW |
| 0x8 | REG2 | RW |
| 0xC | REG3 | RW |

- Address decode: `mapped = (paddr[7:4] == 0) && (paddr[1:0] == 0)`; `paddr[3:2]` selects the register.
- APB transfer: setup phase (`psel = 1`, `penable = 0`) for one cycle, then access phase (`psel = 1`, `penable = 1`). Because `pready = 1` the access phase is always one cycle; the transfer completes on the rising edge at the end of the access phase.
- Write: on the rising edge where `psel & penable & pwrite & mapped`, the selected register takes `pwdata` (all 32 bits; no byte strobes).
- Read: `prdata` = selected register while `psel & !pwrite & mapped` (already valid in the setup phase, sampled by the requester at the end of the access phase); otherwise `prdata = 0`.
- Error: `pslverr = psel & penable & !mapped` — high only during the access phase of an access to an unmapped/unaligned address. Writes to such addresses are ignored and reads return 0.
## Example
| Cycle | psel | penable | pwrite | paddr | pwdata | prdata | pslverr | Note |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 0 | 1 | 0x04 | 0x12345678 | 0 | 0 | write setup |
| 2 | 1 | 1 | 1 | 0x04 | 0x12345678 | 0 | 0 | REG1 written at end of cycle |
| 3 | 1 | 0 | 0 | 0x04 | – | 0x12345678 | 0 | read setup |
| 4 | 1 | 1 | 0 | 0x04 | – | 0x12345678 | 0 | read data sampled |
| 5 | 1 | 0 | 0 | 0x10 | – | 0 | 0 | unmapped setup |
| 6 | 1 | 1 | 0 | 0x10 | – | 0 | 1 | error response |

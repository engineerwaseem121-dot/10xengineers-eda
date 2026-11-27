# timer_apb: APB-programmable down-counting timer with interrupt
## Function
A 32-bit periodic timer controlled over APB. Software writes a reload value to LOAD and enables the timer in CTRL. While enabled, VALUE counts down by one every clock; when it is 0 it reloads from LOAD and sets the pending flag in STATUS. The `irq` output is the pending flag gated by the interrupt enable; software clears it by writing 1 to STATUS bit 0.
## Parameters
None.
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| pclk | in | 1 | APB clock, rising edge |
| presetn | in | 1 | Asynchronous active-low reset |
| psel | in | 1 | APB select |
| penable | in | 1 | APB access phase |
| pwrite | in | 1 | 1 = write |
| paddr | in | 8 | Byte address |
| pwdata | in | 32 | Write data |
| prdata | out | 32 | Read data (combinational) |
| pready | out | 1 | Always 1 (no wait states) |
| pslverr | out | 1 | Error for unmapped address, access phase only |
| irq | out | 1 | Interrupt: `STATUS.pending & CTRL.irq_en` |
## Behaviour
Register map:

| Offset | Name | Access | Reset | Fields |
|---|---|---|---|---|
| 0x0 | LOAD | RW | 0 | [31:0] reload value; a write also copies the value into VALUE |
| 0x4 | VALUE | RO | 0 | [31:0] current count; writes are accepted without error and ignored |
| 0x8 | CTRL | RW | 0 | [0] enable, [1] irq_en, [31:2] read 0 |
| 0xC | STATUS | RW1C | 0 | [0] pending; write 1 clears, write 0 no effect; [31:1] read 0 |

- APB: two-phase setup/access, `pready = 1`. Decode `mapped = (paddr[7:4] == 0) && (paddr[1:0] == 0)`; `pslverr = psel & penable & !mapped`; unmapped writes are ignored and unmapped reads return 0. A write takes effect on the rising edge where `psel & penable & pwrite & mapped`. `prdata` shows the selected register while `psel & !pwrite & mapped`, else 0.
- Counter, each rising edge with `enable = 1`: if `VALUE == 0` then `VALUE <= LOAD` and `pending <= 1` (expiry); else `VALUE <= VALUE − 1`. The period is LOAD + 1 cycles; with LOAD = 0 the timer expires every cycle. With `enable = 0`, VALUE holds.
- Priorities in one cycle: a LOAD write overrides the counter update of VALUE (VALUE takes the written value); an expiry sets `pending` even if the same cycle writes 1 to STATUS (set wins over clear). `pending` is set regardless of `irq_en`; `irq = pending & irq_en` is combinational from registers.
## Example
| Step | APB access | Effect |
|---|---|---|
| 1 | write LOAD = 5 | LOAD = 5, VALUE = 5 |
| 2 | write CTRL = 0x3 | counting starts next edge: 4, 3, 2, 1, 0 |
| 3 | 6 cycles after enable | VALUE reached 0 → reload 5, pending = 1, irq = 1 |
| 4 | read STATUS | 0x1 |
| 5 | write STATUS = 0x1 | pending = 0, irq = 0 (until the next expiry, every 6 cycles) |
| 6 | read 0x20 | prdata = 0, pslverr = 1 |

# apb_master_simple: single-transfer APB requester
## Function
Turns a one-cycle `start` command into one APB read or write transfer. It drives the setup phase for exactly one cycle, then the access phase until the completer answers with `pready`, captures the read data and the error flag, and pulses `done`. Commands arriving while a transfer is in progress are ignored.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| ADDR_W | 8 | Width of `addr` / `paddr` |
| DATA_W | 32 | Width of data buses |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| pclk | in | 1 | APB clock, rising edge |
| presetn | in | 1 | Asynchronous active-low reset |
| start | in | 1 | Start a transfer; sampled only in IDLE |
| write | in | 1 | Transfer direction captured with start (1 = write) |
| addr | in | ADDR_W | Address captured with start |
| wdata | in | DATA_W | Write data captured with start |
| rdata | out | DATA_W | `prdata` of the last completed read (held) |
| done | out | 1 | One-cycle pulse in the cycle after the transfer completed |
| error | out | 1 | `pslverr` of the last completed transfer (held) |
| busy | out | 1 | High while state ≠ IDLE |
| psel | out | 1 | APB select |
| penable | out | 1 | APB enable (access phase) |
| pwrite | out | 1 | APB direction |
| paddr | out | ADDR_W | APB address |
| pwdata | out | DATA_W | APB write data |
| prdata | in | DATA_W | APB read data |
| pready | in | 1 | APB ready (wait states while low) |
| pslverr | in | 1 | APB error response |
## Behaviour
- States (enum `state_t`): `IDLE`, `SETUP`, `ACCESS`. Reset: `IDLE`; `paddr`, `pwrite`, `pwdata`, `rdata`, `done`, `error` = 0.
- IDLE: if `start`, capture `addr → paddr`, `write → pwrite`, `wdata → pwdata` and go to SETUP.
- SETUP (one cycle): `psel = 1`, `penable = 0`; always goes to ACCESS.
- ACCESS: `psel = 1`, `penable = 1`. On a rising edge with `pready = 1` the transfer completes: go to IDLE, set `done <= 1` for one cycle, `error <= pslverr`, and for a read `rdata <= prdata`. With `pready = 0` the access phase is extended (wait states).
- `psel = (state != IDLE)`, `penable = (state == ACCESS)`, `busy = (state != IDLE)`. `paddr`, `pwrite`, `pwdata` stay stable from setup until completion. `psel` always returns low for at least one cycle between transfers (no back-to-back transfers).
- Minimum transfer: start sampled at edge 0 → SETUP in cycle 1 → ACCESS in cycle 2 → `done` in cycle 3. A new `start` may be given in the `done` cycle.
## Example
Read of 0x10 with one wait state:

| Cycle | start | state | psel | penable | pready | done | rdata |
|---|---|---|---|---|---|---|---|
| 0 | 1 | IDLE | 0 | 0 | – | 0 | old |
| 1 | 0 | SETUP | 1 | 0 | – | 0 | old |
| 2 | 0 | ACCESS | 1 | 1 | 0 | 0 | old |
| 3 | 0 | ACCESS | 1 | 1 | 1 | 0 | old |
| 4 | 0 | IDLE | 0 | 0 | – | 1 | mem[0x10] |

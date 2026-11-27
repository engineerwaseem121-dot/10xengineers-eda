# i2c_master_write: simplified single-byte I2C write master
## Function
Writes one data byte to a 7-bit I2C device address: START, address byte with the write bit (0), ACK from the device, data byte, ACK, STOP. SCL is driven directly (no clock stretching, single master). SDA is modelled as `sda_out` plus an output enable `sda_oe` and the bus value `sda_in`; the master releases SDA during the ACK slots and reads the device's answer there. If the address is not acknowledged the data byte is skipped and STOP follows.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| CLK_DIV | 125 | `clk` cycles per quarter of an SCL period; SCL = clk / (4·CLK_DIV) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | System clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| start | in | 1 | Start a write; sampled only when idle |
| dev_addr | in | 7 | Device address, captured with `start` |
| data | in | 8 | Data byte, captured with `start` |
| scl | out | 1 | I2C clock (idle 1) |
| sda_out | out | 1 | SDA value driven when `sda_oe` = 1 |
| sda_oe | out | 1 | 1 = master drives SDA, 0 = SDA released (pulled up) |
| sda_in | in | 1 | SDA bus level |
| busy | out | 1 | High while state ≠ IDLE |
| done | out | 1 | One-cycle pulse after the STOP condition |
| nack | out | 1 | Result of the last write: 1 = address or data not acknowledged (held) |
## Behaviour
- For a real open-drain pad, pull the pin low when `sda_oe & !sda_out` and release it otherwise.
- States (enum `state_t`): `IDLE`, `START`, `ADDR`, `ADDR_ACK`, `DATA`, `DATA_ACK`, `STOP`. Every non-IDLE state is made of slots of four quarter phases (0..3), each CLK_DIV cycles long. Reset: IDLE, `nack = 0`, `done = 0`.
- IDLE: `scl = 1`, `sda_oe = 0`. On `start`: shift register = `{dev_addr, 0}`, data latched, `nack <= 0`, go to START.
- Bus outputs per state and phase (decoded from registers):

| State | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|---|
| START | scl 1, sda 1 | scl 1, sda 0 (START) | scl 1, sda 0 | scl 0, sda 0 |
| ADDR / DATA (one slot per bit) | scl 0, sda = bit | scl 1, sda = bit | scl 1, sda = bit | scl 0, sda = bit |
| ADDR_ACK / DATA_ACK | scl 0, released | scl 1, released | scl 1, released | scl 0, released |
| STOP | scl 0, sda 0 | scl 1, sda 0 | scl 1, sda 1 (STOP) | scl 1, sda 1 |

- Bits are sent MSB first, eight slots per byte; SDA changes only while SCL is low except for START and STOP.
- In an ACK slot, `sda_in` is sampled at the end of phase 1 (SCL high): 0 = ACK, 1 = NACK.
- At the end of a slot: START → ADDR; after 8 address bits → ADDR_ACK; ADDR_ACK with ACK → DATA, with NACK → `nack <= 1`, STOP; after 8 data bits → DATA_ACK; DATA_ACK → `nack <=` sampled bit, STOP; STOP → IDLE with `done <= 1` for one cycle.
- Duration with ACKs: (1 + 9 + 9 + 1) slots × 4·CLK_DIV cycles = 80·CLK_DIV cycles.
## Example
dev_addr = 0x52, data = 0xA5, device acknowledges both bytes:

| Slot | SDA content | Device |
|---|---|---|
| START | 1 → 0 while SCL high | detects START |
| ADDR ×8 | 1,0,1,0,0,1,0, 0 (W) | samples on SCL rising |
| ADDR_ACK | released | pulls SDA low (ACK) |
| DATA ×8 | 1,0,1,0,0,1,0,1 | samples |
| DATA_ACK | released | pulls low (ACK) |
| STOP | 0 → 1 while SCL high | detects STOP; master pulses done, nack = 0 |

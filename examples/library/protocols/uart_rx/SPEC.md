# uart_rx: 8N1 UART receiver
## Function
Receives 8N1 frames (start bit 0, eight data bits LSB first, stop bit 1) from an asynchronous serial line. The input passes a two-flop synchronizer; the receiver detects the falling edge of the start bit, confirms it in the middle of the bit, and then samples every following bit in its middle. A good frame produces a one-cycle `rx_valid` pulse; a frame whose stop bit is 0 produces a one-cycle `framing_error` pulse instead.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| CLKS_PER_BIT | 868 | Clock cycles per bit, must match the transmitter (≥ 4) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| rx | in | 1 | Serial input, idle 1, asynchronous |
| rx_data | out | 8 | Last received byte (held) |
| rx_valid | out | 1 | One-cycle pulse: good frame, `rx_data` updated |
| framing_error | out | 1 | One-cycle pulse: stop bit sampled 0 (`rx_data` also updated) |
## Behaviour
- Synchronizer: `rx_s` = `rx` delayed by two flops (reset value 1).
- States (enum `state_t`): `IDLE`, `START`, `DATA`, `STOP`, `WAIT_HIGH`. Reset: `IDLE`, `rx_data = 0`, pulses 0.
- IDLE: when `rx_s = 0`, go to START with the cycle counter at 0.
- START: after CLKS_PER_BIT/2 cycles (middle of the start bit) check `rx_s`: 0 → DATA (valid start), 1 → IDLE (glitch shorter than half a bit, ignored).
- DATA: every CLKS_PER_BIT cycles sample `rx_s` into the shift register (LSB first: `shreg <= {rx_s, shreg[7:1]}`); after 8 samples go to STOP.
- STOP: after CLKS_PER_BIT cycles (middle of the stop bit) `rx_data <= shreg`; if `rx_s = 1` pulse `rx_valid` and go to IDLE, else pulse `framing_error` and go to WAIT_HIGH.
- WAIT_HIGH: stay until `rx_s = 1`, then IDLE (a line held low after a bad frame does not start a new frame).
- Returning to IDLE in the middle of the stop bit lets back-to-back frames be received. `rx_valid` and `framing_error` are never high together.
## Example
CLKS_PER_BIT = 16, line carries 0x3C (bits 0,0,1,1,1,1,0,0), start bit falling at cycle 0:

| Cycle (approx.) | Event |
|---|---|
| 2–3 | `rx_s` low seen, START |
| ~10 | middle of start bit confirmed |
| ~26, 42, … 138 | data bits sampled |
| ~154 | stop bit sampled 1 → `rx_valid` = 1, `rx_data` = 0x3C |

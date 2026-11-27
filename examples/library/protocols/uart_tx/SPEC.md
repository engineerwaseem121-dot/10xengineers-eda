# uart_tx: 8N1 UART transmitter
## Function
Sends one byte on a serial line in the common 8N1 frame: a low start bit, eight data bits with the least significant bit first, and a high stop bit, each lasting CLKS_PER_BIT clock cycles. The line is high when idle. A one-cycle `tx_done` pulse marks the end of each frame.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| CLKS_PER_BIT | 868 | Clock cycles per bit (clock frequency / baud rate), 1..65536 |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| tx_start | in | 1 | Send `tx_data`; sampled only in IDLE |
| tx_data | in | 8 | Byte to send, captured with `tx_start` |
| tx | out | 1 | Serial output, idle 1 |
| tx_busy | out | 1 | High while a frame is being sent |
| tx_done | out | 1 | One-cycle pulse after the stop bit |
## Behaviour
- States (enum `state_t`): `IDLE`, `START`, `DATA`, `STOP`; counters `clk_cnt` (cycle within the bit) and `bit_idx`; shift register `shreg`.
- Reset: `IDLE`, `tx = 1`, `tx_busy = 0`, `tx_done = 0`.
- IDLE: on a rising edge with `tx_start`, `shreg <= tx_data` and go to START. `tx_start` while busy is ignored.
- START, DATA, STOP each stay for CLKS_PER_BIT cycles per bit (`clk_cnt` counts 0..CLKS_PER_BIT−1). DATA is used for 8 bits; after each bit `shreg` shifts right. After the stop bit: go to IDLE and pulse `tx_done` for one cycle.
- `tx` (from registers): START → 0, DATA → `shreg[0]`, IDLE/STOP → 1. `tx_busy = (state != IDLE)`.
- Timing: with `tx_start` sampled at edge 0, the start bit occupies cycles 1..CPB, data bit i occupies cycles (i+1)·CPB+1 .. (i+2)·CPB, the stop bit 9·CPB+1 .. 10·CPB, and `tx_done` is high in cycle 10·CPB+1 (state already IDLE, a new `tx_start` is accepted in that cycle). Frame length 10·CPB cycles.
## Example
CLKS_PER_BIT = 4, byte 0x55 (LSB first 1,0,1,0,1,0,1,0):

| Cycles | tx | Meaning |
|---|---|---|
| 1–4 | 0 | start bit |
| 5–8 | 1 | bit 0 |
| 9–12 | 0 | bit 1 |
| … | … | bits 2..7 |
| 37–40 | 1 | stop bit |
| 41 | 1 | tx_done = 1, tx_busy = 0 |

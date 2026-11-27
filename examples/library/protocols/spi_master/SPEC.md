# spi_master: SPI mode 0 master, one byte per transfer
## Function
Performs a full-duplex 8-bit SPI transfer in mode 0 (clock idle low, data sampled on the rising edge and changed on the falling edge), most significant bit first. On `start` it lowers `cs_n`, generates eight `sclk` pulses with a programmable half period, shifts `tx_data` out on `mosi` while shifting `miso` in, then raises `cs_n` and pulses `done` with the received byte in `rx_data`.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| CLK_DIV | 4 | `clk` cycles per `sclk` half period (≥ 1); sclk = clk / (2·CLK_DIV) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | System clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| start | in | 1 | Start a transfer; sampled only when idle |
| tx_data | in | 8 | Byte to send, captured with `start` |
| rx_data | out | 8 | Received byte, updated together with `done` (held) |
| done | out | 1 | One-cycle pulse at the end of a transfer |
| busy | out | 1 | High while a transfer is in progress |
| sclk | out | 1 | SPI clock, idle 0 |
| mosi | out | 1 | Master out (`tx_sh[7]`) |
| miso | in | 1 | Master in |
| cs_n | out | 1 | Chip select, active low, idle 1 |
## Behaviour
- States (enum `state_t`): `IDLE`, `SCLK_LOW`, `SCLK_HIGH`, `FINISH`. Reset: IDLE, `sclk = 0`, `cs_n = 1`, `rx_data = 0`, `done = 0`.
- IDLE: on `start`, `tx_sh <= tx_data`, `cs_n <= 0`, go to SCLK_LOW. `mosi` shows bit 7 from the same edge.
- SCLK_LOW (CLK_DIV cycles): at its end `sclk <= 1` (rising edge) and `rx_sh <= {rx_sh[6:0], miso}` (miso sampled at that clk edge); go to SCLK_HIGH.
- SCLK_HIGH (CLK_DIV cycles): at its end `sclk <= 0` (falling edge). After bits 0..6 the shift register moves left so `mosi` shows the next bit, go to SCLK_LOW; after the 8th bit go to FINISH.
- FINISH (CLK_DIV cycles, `cs_n` still low, `sclk` low): at its end `cs_n <= 1`, `rx_data <= rx_sh`, `done <= 1` (one cycle), go to IDLE.
- `busy = (state != IDLE)`. Transfer length: 17·CLK_DIV cycles from the accepting edge to the `done` edge. `mosi` only changes while `sclk` is low.
## Example
CLK_DIV = 2, tx_data = 0xA5, slave sends 0x3C:

| Cycles after start | cs_n | sclk | mosi | Note |
|---|---|---|---|---|
| 1–2 | 0 | 0 | 1 (bit 7) | setup |
| 3–4 | 0 | 1 | 1 | slave samples 1, master samples miso bit 7 = 0 |
| 5–6 | 0 | 0 | 0 (bit 6) | |
| … | | | | 8 pulses in total |
| 33–34 | 0 | 0 | – | FINISH |
| 35 | 1 | 0 | – | done = 1, rx_data = 0x3C |

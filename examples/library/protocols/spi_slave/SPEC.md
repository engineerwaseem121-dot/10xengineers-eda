# spi_slave: SPI mode 0 slave, oversampled by the system clock
## Function
An SPI mode 0 slave (clock idle low, sample on the rising edge, change on the falling edge, MSB first) that runs entirely on the system clock. `sclk`, `cs_n` and `mosi` are synchronized with two flip-flops and the `sclk`/`cs_n` edges are detected in the `clk` domain. Each received byte is reported with a one-cycle `rx_valid` pulse; the byte to return on `miso` is taken from `tx_data`. Frames may contain several bytes.
## Parameters
None.
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | System clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| sclk | in | 1 | SPI clock from the master (asynchronous) |
| cs_n | in | 1 | Chip select, active low (asynchronous) |
| mosi | in | 1 | Master out, slave in |
| miso | out | 1 | Slave out: `tx_sh[7]` while selected, 0 otherwise |
| tx_data | in | 8 | Byte to send; sampled when `cs_n` falls and at the last falling `sclk` edge of each byte |
| rx_data | out | 8 | Last received byte (held) |
| rx_valid | out | 1 | One-cycle pulse when `rx_data` is updated |
## Behaviour
- Synchronizers: `sclk_sync[2:0]`, `cs_sync[2:0]` (shift registers), `mosi_sync[1:0]`. Rising `sclk` = `sclk_sync[2:1] == 01`, falling = `10`, `cs_n` fall = `cs_sync[2:1] == 10`, selected = `!cs_sync[1]`. `mosi_sync[1]` has the same delay as `sclk_sync[1]`.
- Reset: shift registers and `bit_cnt` 0, `rx_data = 0`, `rx_valid = 0`.
- Each `clk` rising edge, in priority order:
  1. Not selected: `bit_cnt <= 0`.
  2. `cs_n` fall: `tx_sh <= tx_data`, `bit_cnt <= 0`.
  3. `sclk` rise: `rx_sh <= {rx_sh[6:0], mosi_sync[1]}`, `bit_cnt++`; when it was the 8th bit (`bit_cnt == 7`), `rx_data <=` the completed byte and `rx_valid <= 1`.
  4. `sclk` fall: if `bit_cnt == 0` (a byte just finished) `tx_sh <= tx_data` (next byte), else `tx_sh` shifts left.
- Timing requirement: edges are seen 2–3 `clk` cycles late, so each `sclk` half period and the time from `cs_n` falling to the first rising `sclk` must be at least 4 `clk` cycles (sclk ≤ clk/8). `rx_valid` comes about 3 cycles after the 8th rising `sclk` edge, before the following falling edge at which the next `tx_data` is loaded.
## Example
Master sends 0x81 while `tx_data` = 0x5A (sclk = clk/12):

| Event | Slave action |
|---|---|
| cs_n falls (+3 clk) | tx_sh = 0x5A, miso = 0 (bit 7) |
| 1st sclk rise | samples mosi = 1 |
| 1st sclk fall | miso = 1 (bit 6) |
| … | |
| 8th sclk rise (+3 clk) | rx_data = 0x81, rx_valid = 1 |
| 8th sclk fall | tx_sh = tx_data (next byte) |

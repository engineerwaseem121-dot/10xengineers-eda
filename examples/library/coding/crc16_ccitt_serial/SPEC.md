# crc16_ccitt_serial: bit-serial CRC-16-CCITT
## Function
Computes CRC-16-CCITT over a serial bit stream, one bit per enabled clock cycle. Polynomial 0x1021 (x^16 + x^12 + x^5 + 1), initial value 0xFFFF, no reflection, no final XOR (the "CCITT-FALSE" variant). Bytes are fed MSB first; after the last bit `crc` holds the result.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | input | 1 | Clock, rising edge |
| rst_n | input | 1 | Asynchronous reset, active low |
| init | input | 1 | Synchronous re-initialise to 0xFFFF |
| en | input | 1 | Shift in `din` this cycle |
| din | input | 1 | Serial data bit |
| crc | output | 16 | Current CRC register |
## Behaviour
- `rst_n = 0` (asynchronous, any time): `crc = 0xFFFF`.
- On each rising edge of `clk` with `rst_n = 1`, in priority order:
  1. `init = 1`: `crc <= 0xFFFF` (`en` and `din` are ignored).
  2. else `en = 1`: with `fb = crc[15] ^ din`, `crc <= {crc[14:0], 1'b0} ^ (fb ? 0x1021 : 0x0000)`.
     Per bit: `crc'[0] = fb`, `crc'[5] = crc[4] ^ fb`, `crc'[12] = crc[11] ^ fb`, every other `crc'[i] = crc[i-1]`.
  3. else: `crc` holds.
- Latency: each bit is absorbed on the clock edge where `en = 1`; `crc` is updated right after that edge. A byte takes 8 enabled cycles.
## Example
| Start crc | Input | crc after |
|---|---|---|
| (reset) | none | 0xFFFF |
| 0xFFFF | one bit din = 1 | 0xFFFE |
| 0xFFFF | one bit din = 0 | 0xEFDF |
| 0xFFFF | ASCII "123456789" (72 bits, each byte MSB first) | 0x29B1 |
| any | init = 1 | 0xFFFF |

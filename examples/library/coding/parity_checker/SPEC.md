# parity_checker: 8-bit even parity checker
## Function
Checks an 8-bit data word against a received even-parity bit. `error` goes high when the 9-bit word formed by `data` and `parity_in` has an odd number of ones, which means a single-bit (or any odd number of bits) error happened.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| data | input | 8 | Received data word |
| parity_in | input | 1 | Received even parity bit |
| error | output | 1 | 1 when the parity does not match |
## Behaviour
Purely combinational: `error = data[7] ^ ... ^ data[0] ^ parity_in`.
- Even number of ones in `{data, parity_in}`: `error = 0`.
- Odd number of ones: `error = 1`.
## Example
| data | parity_in | error |
|---|---|---|
| 0x00 | 0 | 0 |
| 0x00 | 1 | 1 |
| 0x01 | 1 | 0 |
| 0x01 | 0 | 1 |
| 0xA5 | 0 | 0 |
| 0x07 | 0 | 1 |

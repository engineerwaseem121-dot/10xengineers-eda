# rom16x8: 16 x 8 synchronous ROM
## Function
A read-only memory of 16 bytes, defined by a case table. The output is registered: `dout` shows the word
at `addr` one clock after the address is presented. The contents are the squares of the address.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | 16 words x 8 bits, fixed contents |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low (clears the output register only) |
| addr | in | 4 | Read address |
| dout | out | 8 | Registered read data |
## Behaviour
- Contents: `ROM[a] = a * a` (decimal):

| addr | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| data | 0 | 1 | 4 | 9 | 16 | 25 | 36 | 49 | 64 | 81 | 100 | 121 | 144 | 169 | 196 | 225 |

- While `rst_n = 0`: `dout = 8'h00` immediately.
- Every rising edge with `rst_n = 1`: `dout <= ROM[addr]`. Read latency 1 clock. There is no write port.
## Example
| Edge | addr | dout after edge |
|---|---|---|
| 1 | 3 | 9 |
| 2 | 15 | 225 |
| 3 | 0 | 0 |
| 4 | 12 | 144 |

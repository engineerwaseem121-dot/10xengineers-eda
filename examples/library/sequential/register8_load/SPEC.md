# register8_load: 8-bit register with load enable
## Function
An 8-bit storage register. When `load` is high on a rising clock edge it captures `din`;
otherwise it keeps its contents. An asynchronous active-low reset clears it to zero.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| load | in | 1 | Load enable |
| din | in | 8 | Parallel data input |
| dout | out | 8 | Register contents |
## Behaviour
- While `rst_n = 0`: `dout = 8'h00` immediately.
- Rising edge, `rst_n = 1`, `load = 1`: `dout <= din`.
- Rising edge, `rst_n = 1`, `load = 0`: `dout` unchanged.
- Latency `din` to `dout`: 1 clock.
## Example
| Edge | load | din | dout after edge |
|---|---|---|---|
| reset | x | x | 00 |
| 1 | 1 | A5 | A5 |
| 2 | 0 | 3C | A5 |
| 3 | 1 | 3C | 3C |
| 4 | 0 | FF | 3C |

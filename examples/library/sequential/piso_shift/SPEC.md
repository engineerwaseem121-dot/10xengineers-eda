# piso_shift: 8-bit parallel-in serial-out shift register (MSB first)
## Function
Loads an 8-bit word in parallel, then shifts it out one bit per clock on `sout`, most significant bit first.
Zeros are shifted in behind the data.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | 8 bits, fixed |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| load | in | 1 | Parallel load (has priority over shifting) |
| pin | in | 8 | Parallel input |
| sout | out | 1 | Serial output = `sr[7]` |
## Behaviour
- Internal register `sr[7:0]`. While `rst_n = 0`: `sr = 8'h00` immediately.
- Rising edge, `load = 1`: `sr <= pin`. Load has priority over shift.
- Rising edge, `load = 0`: `sr <= {sr[6:0], 1'b0}` (shift left, zero fill).
- `sout = sr[7]` combinationally. Right after the load edge `sout = pin[7]`; after the k-th following
  shift edge `sout = pin[7-k]` (k = 1..7); after 8 shifts `sout = 0`.
- Loading during a shift simply restarts with the new word.
## Example
Load `pin = 8'b1011_0001`, then 7 shift edges:

| After edge | load | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| sout | 1 | 0 | 1 | 1 | 0 | 0 | 0 | 1 | 0 |

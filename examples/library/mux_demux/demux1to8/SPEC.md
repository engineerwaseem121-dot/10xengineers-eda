# demux1to8: 1:8 demultiplexer
## Function
Routes the WIDTH-bit input `din` to one of eight WIDTH-bit slots of the packed output `dout`, chosen by the 3-bit `sel`. All other slots are driven to 0. Slot 0 is the least significant slice. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Data width of `din` and of each output slot |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| din | in | WIDTH | Data input |
| sel | in | 3 | Output slot select, 0..7 |
| dout | out | 8*WIDTH | Eight packed outputs; slot k = `dout[k*WIDTH +: WIDTH]` |
## Behaviour
For k in 0..7: `dout[k*WIDTH +: WIDTH] = (sel == k) ? din : 0`. Equivalently `dout = din << (sel*WIDTH)` (zero-extended to 8*WIDTH bits).
## Example
WIDTH = 8, din = 8'hC3:

| sel | dout |
|---|---|
| 0 | 64'h0000_0000_0000_00C3 |
| 1 | 64'h0000_0000_0000_C300 |
| 4 | 64'h0000_00C3_0000_0000 |
| 7 | 64'hC300_0000_0000_0000 |

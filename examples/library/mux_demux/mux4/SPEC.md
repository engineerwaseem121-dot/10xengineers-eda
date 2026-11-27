# mux4: 4:1 multiplexer
## Function
Selects one of four WIDTH-bit data inputs `d0`..`d3` using the 2-bit `sel` and drives it on `y`. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Data width |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| d0 | in | WIDTH | Data input 0 |
| d1 | in | WIDTH | Data input 1 |
| d2 | in | WIDTH | Data input 2 |
| d3 | in | WIDTH | Data input 3 |
| sel | in | 2 | Select, 0..3 |
| y | out | WIDTH | Selected data |
## Behaviour
| sel | y |
|---|---|
| 2'd0 | d0 |
| 2'd1 | d1 |
| 2'd2 | d2 |
| 2'd3 | d3 |

All four codes are legal; there is no invalid select value.
## Example
d0 = 8'hA0, d1 = 8'hB1, d2 = 8'hC2, d3 = 8'hD3:

| sel | y |
|---|---|
| 0 | 8'hA0 |
| 1 | 8'hB1 |
| 2 | 8'hC2 |
| 3 | 8'hD3 |

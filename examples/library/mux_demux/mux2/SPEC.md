# mux2: 2:1 multiplexer
## Function
Selects one of two WIDTH-bit data inputs and drives it on the output. `sel = 0` picks `a`, `sel = 1` picks `b`. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Data width |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | Data input 0 |
| b | in | WIDTH | Data input 1 |
| sel | in | 1 | Select: 0 = a, 1 = b |
| y | out | WIDTH | Selected data |
## Behaviour
`y = (sel == 0) ? a : b`.
## Example
WIDTH = 8:

| a | b | sel | y |
|---|---|---|---|
| 8'h11 | 8'h22 | 0 | 8'h11 |
| 8'h11 | 8'h22 | 1 | 8'h22 |
| 8'hFF | 8'h00 | 1 | 8'h00 |

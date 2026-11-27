# mux8: 8:1 multiplexer
## Function
Selects one of eight WIDTH-bit inputs, packed side by side in `in_data`, using the 3-bit `sel`, and drives it on `y`. Input 0 is the least significant slice. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Width of each data input and of `y` |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| in_data | in | 8*WIDTH | Eight packed inputs; input k = `in_data[k*WIDTH +: WIDTH]` |
| sel | in | 3 | Select, 0..7 |
| y | out | WIDTH | Selected input |
## Behaviour
`y = in_data[sel*WIDTH +: WIDTH]`, i.e. `y = in_data[(sel+1)*WIDTH-1 : sel*WIDTH]`. All eight select codes are legal.
## Example
WIDTH = 8, in_data = 64'h7766_5544_3322_1100 (input 0 = 8'h00, input 1 = 8'h11, ..., input 7 = 8'h77):

| sel | y |
|---|---|
| 0 | 8'h00 |
| 1 | 8'h11 |
| 5 | 8'h55 |
| 7 | 8'h77 |

# mux_param: parameterized N:1 multiplexer
## Function
Selects one of N WIDTH-bit inputs, packed side by side in `in_data`, using `sel`, and drives it on `y`. Input 0 is the least significant slice. When N is not a power of two, select codes N and above are out of range and give `y = 0`. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| N | 4 | Number of data inputs (N >= 1) |
| WIDTH | 8 | Width of each data input and of `y` |
| SEL_W | `$clog2(N)` (1 when N = 1) | Width of `sel`; derived, normally not overridden |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| in_data | in | N*WIDTH | N packed inputs; input k = `in_data[k*WIDTH +: WIDTH]` |
| sel | in | SEL_W | Select, 0..N-1 |
| y | out | WIDTH | Selected input |
## Behaviour
- If `sel < N`: `y = in_data[sel*WIDTH +: WIDTH]`.
- If `sel >= N` (only possible when N is not a power of two, or N = 1 with sel = 1): `y = 0`.
## Example
N = 4, WIDTH = 8, in_data = 32'hDD_CC_BB_AA (input 0 = 8'hAA, input 3 = 8'hDD):

| sel | y |
|---|---|
| 0 | 8'hAA |
| 1 | 8'hBB |
| 2 | 8'hCC |
| 3 | 8'hDD |

N = 5, WIDTH = 8 (SEL_W = 3): sel = 5, 6 or 7 gives y = 8'h00.

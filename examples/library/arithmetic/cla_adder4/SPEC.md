# cla_adder4: 4-bit carry-lookahead adder
## Function
Adds two 4-bit unsigned operands and a carry input. Every carry is computed directly from per-bit generate and propagate signals and `cin` (two logic levels), instead of rippling from bit to bit. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | - | Fixed 4-bit width |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | 4 | Operand A |
| b | in | 4 | Operand B |
| cin | in | 1 | Carry in |
| sum | out | 4 | Sum, `(a + b + cin) mod 16` |
| cout | out | 1 | Carry out |
## Behaviour
- Generate `g[i] = a[i] & b[i]`, propagate `p[i] = a[i] ^ b[i]`, `c0 = cin`.
- `c1 = g0 | p0 c0`
- `c2 = g1 | p1 g0 | p1 p0 c0`
- `c3 = g2 | p2 g1 | p2 p1 g0 | p2 p1 p0 c0`
- `c4 = g3 | p3 g2 | p3 p2 g1 | p3 p2 p1 g0 | p3 p2 p1 p0 c0`
- `sum[i] = p[i] ^ c[i]`, `cout = c4`.

Result is identical to `{cout, sum} = a + b + cin`.
## Example
| a | b | cin | cout | sum |
|---|---|---|---|---|
| 4'h0 | 4'h0 | 0 | 0 | 4'h0 |
| 4'h7 | 4'h8 | 0 | 0 | 4'hF |
| 4'h7 | 4'h8 | 1 | 1 | 4'h0 |
| 4'hF | 4'hF | 1 | 1 | 4'hF |
| 4'h5 | 4'h3 | 0 | 0 | 4'h8 |

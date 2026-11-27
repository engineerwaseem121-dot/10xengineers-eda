# and_n: N-input AND gate
## Function
AND of all N bits of the input vector `a`. The output is 1 only when every bit of `a` is 1. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| N | 4 | Number of inputs (width of `a`), N >= 1 |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | N | Gate inputs, one per bit |
| y | out | 1 | AND of all bits of `a` |
## Behaviour
`y = a[0] & a[1] & ... & a[N-1]` (reduction AND, `y = &a`). Equivalently `y = (a == {N{1'b1}})`.
## Example
N = 4:

| a | y |
|---|---|
| 4'b0000 | 0 |
| 4'b0111 | 0 |
| 4'b1110 | 0 |
| 4'b1111 | 1 |

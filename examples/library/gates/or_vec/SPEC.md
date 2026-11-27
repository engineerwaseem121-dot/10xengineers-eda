# or_vec: bitwise OR of two vectors
## Function
A bank of WIDTH independent 2-input OR gates. Bit i of the output is the OR of bit i of `a` and bit i of `b`. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Width of the input and output vectors |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| a | in | WIDTH | First operand vector |
| b | in | WIDTH | Second operand vector |
| y | out | WIDTH | Bitwise OR result |
## Behaviour
For every i in 0..WIDTH-1: `y[i] = a[i] | b[i]` (i.e. `y = a | b`). No carries or interaction between bits.
## Example
WIDTH = 8:

| a | b | y |
|---|---|---|
| 8'h00 | 8'h00 | 8'h00 |
| 8'hF0 | 8'h0F | 8'hFF |
| 8'hA5 | 8'h81 | 8'hA5 |
| 8'h12 | 8'h40 | 8'h52 |

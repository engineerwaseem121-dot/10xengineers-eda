# demux1to4: 1:4 demultiplexer
## Function
Routes the WIDTH-bit input `din` to one of four outputs `y0`..`y3` chosen by the 2-bit `sel`. The three outputs that are not selected are driven to 0. Purely combinational.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| WIDTH | 8 | Data width |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| din | in | WIDTH | Data input |
| sel | in | 2 | Output select, 0..3 |
| y0 | out | WIDTH | din when sel = 0, else 0 |
| y1 | out | WIDTH | din when sel = 1, else 0 |
| y2 | out | WIDTH | din when sel = 2, else 0 |
| y3 | out | WIDTH | din when sel = 3, else 0 |
## Behaviour
For k in 0..3: `yk = (sel == k) ? din : 0`.
## Example
din = 8'h5A:

| sel | y0 | y1 | y2 | y3 |
|---|---|---|---|---|
| 0 | 8'h5A | 8'h00 | 8'h00 | 8'h00 |
| 1 | 8'h00 | 8'h5A | 8'h00 | 8'h00 |
| 2 | 8'h00 | 8'h00 | 8'h5A | 8'h00 |
| 3 | 8'h00 | 8'h00 | 8'h00 | 8'h5A |

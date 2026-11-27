# fifo_almost: synchronous FIFO with almost-full / almost-empty flags
## Function
The same synchronous FIFO as `fifo_sync` (registered read data, full/empty/count, dropped overflow and
underflow requests) with two extra threshold flags. `almost_full` warns that only `AF_GAP` or fewer free
slots remain; `almost_empty` warns that `AE_GAP` or fewer entries remain.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| DEPTH | 8 | Number of entries (power of two, >= 2) |
| WIDTH | 8 | Bits per entry |
| AF_GAP | 2 | `almost_full = (count >= DEPTH - AF_GAP)` |
| AE_GAP | 2 | `almost_empty = (count <= AE_GAP)` |
| AW | $clog2(DEPTH) | Pointer width (derived) |
| CW | $clog2(DEPTH+1) | Width of `count` (derived) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| wr_en | in | 1 | Write request |
| din | in | WIDTH | Write data |
| rd_en | in | 1 | Read request |
| dout | out | WIDTH | Read data (registered) |
| full | out | 1 | `count == DEPTH` |
| empty | out | 1 | `count == 0` |
| almost_full | out | 1 | `count >= DEPTH - AF_GAP` |
| almost_empty | out | 1 | `count <= AE_GAP` |
| count | out | CW | Number of stored entries, 0..DEPTH |
## Behaviour
- While `rst_n = 0`: empty (`count = 0`), `dout = 0` immediately; so `almost_empty = 1` and `almost_full = 0`
  (for `AF_GAP < DEPTH`).
- Write accepted iff `wr_en = 1` and `full = 0`; read accepted iff `rd_en = 1` and `empty = 0`
  (state before the edge). Dropped requests have no effect, also when the other side is active on the same edge.
- Rising edge with `rst_n = 1`: accepted write stores `din` at the tail; accepted read sets `dout <=` head word
  and removes it; `count` +1 (write only), -1 (read only), unchanged otherwise. `dout` changes only on an
  accepted read.
- All four flags are combinational from `count`, valid right after each edge.
## Example
DEPTH = 8, AF_GAP = 2, AE_GAP = 2, writes only:

| count after edge | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| almost_empty | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| almost_full | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| full | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |

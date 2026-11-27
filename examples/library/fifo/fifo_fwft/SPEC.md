# fifo_fwft: first-word-fall-through FIFO
## Function
A synchronous FIFO of `DEPTH` x `WIDTH` in which the oldest stored word is always presented on `dout`
combinationally while the FIFO is not empty. Asserting `rd_en` acknowledges (pops) that word on the next
rising edge, after which the following word appears on `dout`. There is no read latency.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| DEPTH | 8 | Number of entries (power of two, >= 2) |
| WIDTH | 8 | Bits per entry |
| AW | $clog2(DEPTH) | Pointer width (derived) |
| CW | $clog2(DEPTH+1) | Width of `count` (derived) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge active |
| rst_n | in | 1 | Asynchronous reset, active low |
| wr_en | in | 1 | Write request |
| din | in | WIDTH | Write data |
| rd_en | in | 1 | Pop request (acknowledges the word on `dout`) |
| dout | out | WIDTH | Head word; 0 while empty (combinational) |
| full | out | 1 | `count == DEPTH` |
| empty | out | 1 | `count == 0` |
| count | out | CW | Number of stored entries, 0..DEPTH |
## Behaviour
- While `rst_n = 0`: FIFO emptied (`count = 0`, pointers 0) immediately, so `dout = 0`, `empty = 1`.
- `dout = empty ? 0 : head word`, combinational. The word on `dout` while `rd_en = 1` is the word being read.
- Write accepted iff `wr_en = 1` and `full = 0`; pop accepted iff `rd_en = 1` and `empty = 0`
  (state before the edge). Dropped requests have no effect, even if the other side is active on the same edge.
- Rising edge with `rst_n = 1`: accepted write stores `din` at the tail; accepted pop removes the head;
  `count` +1 (write only), -1 (pop only), unchanged otherwise.
- A word written into an empty FIFO appears on `dout` right after that write edge (write-to-dout latency 1 clock).
## Example
| Step | wr_en | din | rd_en | dout after edge | count after |
|---|---|---|---|---|---|
| reset | | | | 00 | 0 |
| edge 1 | 1 | 11 | 0 | 11 | 1 |
| edge 2 | 1 | 22 | 0 | 11 | 2 |
| edge 3 | 0 | | 1 | 22 | 1 |
| edge 4 | 1 | 33 | 1 | 33 | 1 |
| edge 5 | 0 | | 1 | 00 (empty) | 0 |
| edge 6 | 0 | | 1 | 00 (ignored) | 0 |

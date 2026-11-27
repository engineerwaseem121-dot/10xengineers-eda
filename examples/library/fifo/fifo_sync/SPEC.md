# fifo_sync: synchronous FIFO with full/empty/count
## Function
A first-in first-out buffer of `DEPTH` words of `WIDTH` bits, with one clock for both sides.
Words written with `wr_en` are read back in the same order with `rd_en`; the read word appears on the
registered output `dout` after the read edge. Writes when full and reads when empty are ignored.
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
| rd_en | in | 1 | Read request |
| dout | out | WIDTH | Read data (registered) |
| full | out | 1 | `count == DEPTH` |
| empty | out | 1 | `count == 0` |
| count | out | CW | Number of stored entries, 0..DEPTH |
## Behaviour
- While `rst_n = 0`: the FIFO becomes empty (`count = 0`, pointers 0) and `dout = 0` immediately.
  Stored data is not cleared but can no longer be read.
- Accept rules, evaluated with the state before the edge:
  - write accepted: `wr_en = 1` and `full = 0`; read accepted: `rd_en = 1` and `empty = 0`.
  - When full, a write is dropped even if a read happens on the same edge.
  - When empty, a read is dropped (`dout` keeps its value) even if a write happens on the same edge.
- Rising edge with `rst_n = 1`:
  - accepted write: `din` is stored at the tail;
  - accepted read: `dout <= head word`, the head is removed;
  - `count` += 1 for write only, -= 1 for read only, unchanged for both or neither.
- `dout` changes only on an accepted read (latency 1 clock from `rd_en` to data). `full`, `empty` and `count`
  are combinational from the registered count and are valid right after each edge.
- Overflow/underflow never corrupts the FIFO; dropped requests have no side effects.
## Example
| Edge | wr_en | din | rd_en | dout after | count after | empty | full |
|---|---|---|---|---|---|---|---|
| reset | | | | 00 | 0 | 1 | 0 |
| 1 | 1 | 11 | 0 | 00 | 1 | 0 | 0 |
| 2 | 1 | 22 | 0 | 00 | 2 | 0 | 0 |
| 3 | 1 | 33 | 1 | 11 | 2 | 0 | 0 |
| 4 | 0 | | 1 | 22 | 1 | 0 | 0 |
| 5 | 0 | | 1 | 33 | 0 | 1 | 0 |
| 6 | 0 | | 1 | 33 (ignored) | 0 | 1 | 0 |

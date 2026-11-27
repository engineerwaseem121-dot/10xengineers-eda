# axis_fifo: 16-entry AXI-Stream FIFO
## Function
A synchronous first-in first-out buffer with AXI-Stream interfaces on both sides. It stores up to 16 beats of `tdata` together with `tlast`. The input is ready whenever the FIFO is not full and the output is valid whenever it is not empty; the head beat is shown on the output without an extra read cycle (first-word fall-through).
## Parameters
| Name | Default | Meaning |
|---|---|---|
| DATA_W | 8 | Width of `tdata` |
| DEPTH | 16 | Number of entries (power of two) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| aclk | in | 1 | Clock, rising edge |
| aresetn | in | 1 | Asynchronous active-low reset |
| s_axis_tdata | in | DATA_W | Input beat data |
| s_axis_tvalid | in | 1 | Input beat valid |
| s_axis_tlast | in | 1 | Input end of packet |
| s_axis_tready | out | 1 | `count != DEPTH` |
| m_axis_tdata | out | DATA_W | Head beat data |
| m_axis_tvalid | out | 1 | `count != 0` |
| m_axis_tlast | out | 1 | Head beat end of packet |
| m_axis_tready | in | 1 | Output ready |
## Behaviour
- State: storage array `mem[DEPTH]` of `{tlast, tdata}`, write pointer, read pointer, `count` (0..DEPTH). Reset: pointers and `count` = 0 (FIFO empty; storage is not cleared).
- `push = s_axis_tvalid & s_axis_tready`, `pop = m_axis_tvalid & m_axis_tready`.
- Each rising edge: on `push` the beat is written at the write pointer and the pointer increments (wraps); on `pop` the read pointer increments; `count` +1 on push only, −1 on pop only, unchanged on both or neither. Push and pop in the same cycle are allowed whenever the FIFO is neither empty nor full. When full, `s_axis_tready = 0`, so no push happens even if a pop happens in that cycle; when empty, `m_axis_tvalid = 0`, so no pop happens.
- Outputs (combinational from registers): `m_axis_tdata/tlast = mem[rd_ptr]`, `m_axis_tvalid = (count != 0)`, `s_axis_tready = (count != DEPTH)`. `m_axis_tdata` is undefined while `m_axis_tvalid = 0`.
- A beat written at edge k is visible on the output after that edge (latency 1 cycle when the FIFO was empty). Overflow and underflow cannot happen because the handshakes are gated by the flags.
## Example
| Cycle | s_tvalid / s_tdata | m_tready | count after edge | m_tvalid / m_tdata after edge |
|---|---|---|---|---|
| 1 | 1 / 0x11 | 0 | 1 | 1 / 0x11 |
| 2 | 1 / 0x22 (tlast) | 0 | 2 | 1 / 0x11 |
| 3 | 0 | 1 | 1 | 1 / 0x22 (tlast = 1) |
| 4 | 0 | 1 | 0 | 0 |

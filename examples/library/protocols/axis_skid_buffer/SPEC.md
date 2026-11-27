# axis_skid_buffer: AXI-Stream register slice with skid buffer
## Function
Breaks the combinational timing paths of an AXI-Stream link in both directions while keeping full throughput (one beat per cycle). All outputs, including `s_axis_tready`, come straight from flip-flops. A second (skid) register catches the one beat that may arrive in the cycle in which the downstream side stalls.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| DATA_W | 8 | Width of `tdata` |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| aclk | in | 1 | Clock, rising edge |
| aresetn | in | 1 | Asynchronous active-low reset |
| s_axis_tdata | in | DATA_W | Input beat data |
| s_axis_tvalid | in | 1 | Input beat valid |
| s_axis_tlast | in | 1 | Input end of packet |
| s_axis_tready | out | 1 | Input ready (= skid register empty) |
| m_axis_tdata | out | DATA_W | Output beat data |
| m_axis_tvalid | out | 1 | Output beat valid |
| m_axis_tlast | out | 1 | Output end of packet |
| m_axis_tready | in | 1 | Output ready |
## Behaviour
- Storage: output register (`m_axis_tvalid/tdata/tlast`) and skid register (`skid_valid/data/last`). Reset: both empty, `m_axis_tvalid = 0`, `s_axis_tready = 1`.
- `s_axis_tready = !skid_valid`. An input beat is accepted (`s_fire`) on a rising edge with `s_axis_tvalid & s_axis_tready`. `out_free = !m_axis_tvalid | m_axis_tready`.
- On each rising edge:
  - if `out_free` and the skid register is full: the skid beat moves to the output register, skid becomes empty (no input accepted in this cycle);
  - if `out_free` and the skid register is empty: the output register takes the accepted input beat, or becomes empty (`m_axis_tvalid = 0`) if no beat was accepted;
  - if not `out_free` (output holds a beat that is not taken) and a beat is accepted: the beat goes to the skid register.
- Guarantees: beats leave in the order they arrived with `tdata`/`tlast` unchanged; nothing is lost or duplicated; a stalled output beat stays stable; latency is one cycle when not stalled; with `m_axis_tready` held high a beat can pass every cycle. At most two beats are stored.
## Example
| Cycle | s_tvalid / s_tdata | s_tready | m_tready | m_tvalid / m_tdata after edge |
|---|---|---|---|---|
| 1 | 1 / A | 1 | 1 | 1 / A |
| 2 | 1 / B | 1 | 0 | 1 / A (B goes to skid) |
| 3 | 1 / C | 0 | 0 | 1 / A (C waits) |
| 4 | 1 / C | 0 | 1 | 1 / B (skid drained) |
| 5 | 1 / C | 1 | 1 | 1 / C |

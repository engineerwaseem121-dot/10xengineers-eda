# round_robin_arbiter4: 4-way round-robin arbiter
## Function
Arbitrates between four requesters. Every clock cycle it grants at most one active requester, chosen by rotating priority: the search starts at the requester just after the one granted most recently and wraps around, so every continuously requesting client is served within four cycles. The grant is registered and one-hot.
## Parameters
None.
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| req | in | 4 | Request lines, bit i = requester i |
| grant | out | 4 | One-hot grant (or all zero), decoded from the state register |
## Behaviour
- State register (enum `state_t`): `IDLE`, `G0`, `G1`, `G2`, `G3` (`Gi` = requester i holds the grant this cycle). A 2-bit `last` register remembers the most recent winner, also while `IDLE`.
- Reset: `state = IDLE`, `last = 3` (so requester 0 has top priority first). `grant = 0`.
- On each rising edge: `base` = i when the state is `Gi`, otherwise `last`. The winner is the first `i` with `req[i] = 1` in the order base+1, base+2, base+3, base+4 (mod 4). If there is a winner the next state is `G<winner>` and `last <= winner`; if `req == 0` the next state is `IDLE` and `last` is kept.
- Consequences: a single requester keeps the grant every cycle; with several requesters the grant moves to the next active one every cycle (re-arbitration each cycle, no lock). The grant appears one cycle after the request (registered). A requester that drops `req` loses the grant at the next edge.
- `grant`: `G0`→0001, `G1`→0010, `G2`→0100, `G3`→1000, `IDLE`→0000.
## Example
| Cycle | req | grant after edge |
|---|---|---|
| 1 | 1111 | 0001 |
| 2 | 1111 | 0010 |
| 3 | 1111 | 0100 |
| 4 | 0000 | 0000 (last = 2) |
| 5 | 0101 | 0001 (search 3,0,…) |
| 6 | 0101 | 0100 |
| 7 | 1000 | 1000 |

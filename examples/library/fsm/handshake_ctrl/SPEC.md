# handshake_ctrl: four-phase req/ack handshake initiator
## Function
Drives the request side of a four-phase (return-to-zero) handshake. When `start` is seen while idle it raises `req`, waits for the responder to raise `ack`, lowers `req`, waits for `ack` to fall, and then reports completion with a one-cycle `done` pulse. `busy` is high from the request until the end of the `done` cycle.
## Parameters
None.
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| start | in | 1 | Start a handshake; only sampled in IDLE (ignored while busy) |
| ack | in | 1 | Acknowledge from the responder (must be synchronous to clk) |
| req | out | 1 | Request to the responder |
| busy | out | 1 | High while state ≠ IDLE |
| done | out | 1 | One-cycle pulse after `ack` has returned low |
## Behaviour
- States (enum `state_t`): `IDLE`, `REQ_HIGH`, `REQ_LOW`, `DONE`. Reset → `IDLE` (`req = 0`, `busy = 0`, `done = 0`).
- Transitions on each rising edge:

| State | Condition | Next |
|---|---|---|
| IDLE | start | REQ_HIGH |
| REQ_HIGH | ack | REQ_LOW |
| REQ_LOW | !ack | DONE |
| DONE | always | IDLE |

- Outputs (Moore): `req = (state == REQ_HIGH)`, `busy = (state != IDLE)`, `done = (state == DONE)`.
- The four phases on the wires: (1) `req` rises, (2) `ack` rises, (3) `req` falls one cycle after `ack` is sampled high, (4) `ack` falls; `done` is high in the cycle after `ack` is sampled low. A new handshake can start at the earliest in the cycle after `done` (minimum 4 cycles per handshake with a zero-delay responder). `req` never rises while `ack` is high and never falls before `ack` was seen high.
## Example
| Cycle | start | ack | state after edge | req | busy | done |
|---|---|---|---|---|---|---|
| 1 | 1 | 0 | REQ_HIGH | 1 | 1 | 0 |
| 2 | 0 | 0 | REQ_HIGH | 1 | 1 | 0 |
| 3 | 0 | 1 | REQ_LOW | 0 | 1 | 0 |
| 4 | 0 | 1 | REQ_LOW | 0 | 1 | 0 |
| 5 | 0 | 0 | DONE | 0 | 1 | 1 |
| 6 | 0 | 0 | IDLE | 0 | 0 | 0 |

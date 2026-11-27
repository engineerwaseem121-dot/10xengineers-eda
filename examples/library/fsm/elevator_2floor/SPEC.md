# elevator_2floor: two-floor elevator controller
## Function
Controls a car serving floors 0 and 1. Call buttons are latched as pending requests. When idle, the car first opens its door if its own floor is called, otherwise it drives to the other floor if that one is called; arriving at a floor always opens the door. Door and travel durations are counted in clock cycles by an internal timer.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| DOOR_TIME | 4 | Cycles the door stays open (1..256) |
| TRAVEL_TIME | 8 | Cycles the motor runs to move between floors (1..256) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| call0 | in | 1 | Call button for floor 0 (any length pulse; latched) |
| call1 | in | 1 | Call button for floor 1 (any length pulse; latched) |
| floor | out | 1 | Floor the car is at; while moving, the floor being left |
| door_open | out | 1 | Door open |
| motor_up | out | 1 | Motor driving up (0 → 1) |
| motor_down | out | 1 | Motor driving down (1 → 0) |
## Behaviour
- States (enum `state_t`): `IDLE0`, `DOOR0`, `UP`, `IDLE1`, `DOOR1`, `DOWN`. Registers: `timer` (8 bit), `pend0`, `pend1`.
- Reset: `state = IDLE0`, `timer = 0`, `pend0 = pend1 = 0` (car at floor 0, door closed, motor off).
- `want0 = pend0 | call0`, `want1 = pend1 | call1` (a call counts in the same cycle it is pressed).
- Next state on each rising edge:

| State | Condition | Next |
|---|---|---|
| IDLE0 | want0 | DOOR0 |
| IDLE0 | !want0 & want1 | UP |
| DOOR0 | timer == DOOR_TIME−1 | IDLE0 |
| UP | timer == TRAVEL_TIME−1 | DOOR1 |
| IDLE1 | want1 | DOOR1 |
| IDLE1 | !want1 & want0 | DOWN |
| DOOR1 | timer == DOOR_TIME−1 | IDLE1 |
| DOWN | timer == TRAVEL_TIME−1 | DOOR0 |

- `timer` is cleared on every state change and increments otherwise, so DOOR states last DOOR_TIME cycles and UP/DOWN last TRAVEL_TIME cycles.
- Calls: `pend0 <= want0 & (next_state != DOOR0)`, `pend1 <= want1 & (next_state != DOOR1)`. A call for a floor whose door is opening or already open is served immediately and not kept. Calls pressed while moving or during a door cycle stay pending and are handled at the next IDLE state.
- Outputs (Moore): `door_open` in DOOR0/DOOR1, `motor_up` in UP, `motor_down` in DOWN, `floor = 1` in IDLE1, DOOR1, DOWN, else 0. Motor and door are never active together.
## Example
DOOR_TIME = 3, TRAVEL_TIME = 5, car idle at floor 0:

| Cycle | Input | State after edge | Outputs |
|---|---|---|---|
| 1 | call1 | UP | motor_up, floor=0 |
| 2–5 | — | UP | motor_up |
| 6 | — | DOOR1 | door_open, floor=1 |
| 7–8 | call0 (cycle 7) | DOOR1 | door_open |
| 9 | — | IDLE1 | floor=1 |
| 10 | — | DOWN (pending call0) | motor_down, floor=1 |

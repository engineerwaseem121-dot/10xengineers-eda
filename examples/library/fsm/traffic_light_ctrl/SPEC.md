# traffic_light_ctrl: two-way traffic light controller
## Function
Controls the lights of a crossing with a north-south (NS) road and an east-west (EW) road. A four-state Moore FSM cycles NS green → NS yellow → EW green → EW yellow → NS green, staying in each state for a fixed number of clock cycles counted by an internal timer. While one direction is green or yellow the other direction is red.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| GREEN_TIME | 8 | Clock cycles spent in each green state (1..256) |
| YELLOW_TIME | 2 | Clock cycles spent in each yellow state (1..256) |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| ns_red | out | 1 | North-south red lamp |
| ns_yellow | out | 1 | North-south yellow lamp |
| ns_green | out | 1 | North-south green lamp |
| ew_red | out | 1 | East-west red lamp |
| ew_yellow | out | 1 | East-west yellow lamp |
| ew_green | out | 1 | East-west green lamp |
## Behaviour
- State register (enum `state_t`): `NS_GREEN`, `NS_YELLOW`, `EW_GREEN`, `EW_YELLOW`; 8-bit `timer` counts cycles spent in the current state.
- Reset: `state = NS_GREEN`, `timer = 0`.
- Each rising edge: if `timer` equals the state's duration − 1 (GREEN_TIME−1 in green states, YELLOW_TIME−1 in yellow states) the FSM moves to the next state in the cycle and `timer` returns to 0; otherwise `timer` increments and the state is held.
- Outputs are decoded from the state only (Moore):

| State | ns_red | ns_yellow | ns_green | ew_red | ew_yellow | ew_green |
|---|---|---|---|---|---|---|
| NS_GREEN | 0 | 0 | 1 | 1 | 0 | 0 |
| NS_YELLOW | 0 | 1 | 0 | 1 | 0 | 0 |
| EW_GREEN | 1 | 0 | 0 | 0 | 0 | 1 |
| EW_YELLOW | 1 | 0 | 0 | 0 | 1 | 0 |

- Durations: NS green GREEN_TIME cycles, NS yellow YELLOW_TIME cycles, EW green GREEN_TIME, EW yellow YELLOW_TIME; full period = 2·GREEN_TIME + 2·YELLOW_TIME cycles. Exactly one lamp per direction is on at any time; both directions are never green or yellow together.
## Example
Defaults (GREEN_TIME=8, YELLOW_TIME=2), cycles counted from reset release:

| Cycles | Lights |
|---|---|
| 0–7 | NS green, EW red |
| 8–9 | NS yellow, EW red |
| 10–17 | NS red, EW green |
| 18–19 | NS red, EW yellow |
| 20 | back to NS green |

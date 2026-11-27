# vending_machine: coin-operated vending FSM (price 15, coins 5 and 10)
## Function
Accepts 5 and 10 coins one per clock cycle, accumulates credit, and dispenses an item when the credit reaches the price of 15. If the last coin brings the credit to 20, a 5 coin is returned as change together with the item. Credit is then cleared. Moore FSM: outputs are decoded from the state.
## Parameters
None (price 15 and coin values 5/10 are fixed by the state encoding).
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| clk | in | 1 | Clock, rising edge |
| rst_n | in | 1 | Asynchronous active-low reset |
| coin5 | in | 1 | A 5 coin is inserted in this cycle (sampled on rising edge) |
| coin10 | in | 1 | A 10 coin is inserted in this cycle (sampled on rising edge) |
| vend | out | 1 | Item dispensed, high for one cycle |
| change | out | 1 | 5 change returned, high for one cycle (only together with vend) |
## Behaviour
- States (enum `state_t`): `S_0` (credit 0), `S_5`, `S_10`, `S_VEND` (dispense, credit 0), `S_VEND_CHG` (dispense + change, credit 0). Reset → `S_0`.
- Accepted coin in a cycle: `c5 = coin5 & ~coin10`, `c10 = coin10 & ~coin5`. `coin5` and `coin10` high together is illegal and is ignored (no coin accepted, credit unchanged).
- Next state on each rising edge:

| State | c5 | c10 | no coin |
|---|---|---|---|
| S_0 / S_VEND / S_VEND_CHG | S_5 | S_10 | S_0 |
| S_5 | S_10 | S_VEND | S_5 |
| S_10 | S_VEND | S_VEND_CHG | S_10 |

- Outputs: `vend = (state == S_VEND) | (state == S_VEND_CHG)`, `change = (state == S_VEND_CHG)`.
- Latency: `vend` is high in the cycle after the edge that sampled the coin completing the price. The dispense state holds no credit and accepts a new coin in the same cycle, so back-to-back purchases need no idle cycle. Credit is kept indefinitely while no coin is inserted.
## Example
| Cycle | coin5 | coin10 | state after edge | vend | change |
|---|---|---|---|---|---|
| 1 | 1 | 0 | S_5 | 0 | 0 |
| 2 | 0 | 1 | S_VEND | 1 | 0 |
| 3 | 0 | 1 | S_10 | 0 | 0 |
| 4 | 0 | 1 | S_VEND_CHG | 1 | 1 |
| 5 | 1 | 1 | S_0 (ignored) | 0 | 0 |

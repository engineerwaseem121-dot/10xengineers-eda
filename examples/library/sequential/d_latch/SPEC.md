# d_latch: transparent-high D latch
## Function
A level-sensitive storage element. While `en` is high the latch is transparent and `q` follows `d`.
When `en` falls, `q` keeps the value `d` had at that moment until `en` rises again. No clock, no reset.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| en | in | 1 | Enable (gate), transparent when 1 |
| d | in | 1 | Data input |
| q | out | 1 | Latched output |
## Behaviour
- `en = 1`: `q = d` (combinational pass-through, every change of `d` appears on `q`).
- `en = 0`: `q` holds the last value it had while `en` was 1.
- No reset: `q` is unknown until `en` has been 1 at least once.
- Not a clocked design: no `clk`, no edge behaviour.
## Example
| Step | en | d | q |
|---|---|---|---|
| 1 | 1 | 1 | 1 |
| 2 | 1 | 0 | 0 |
| 3 | 0 | 1 | 0 (held) |
| 4 | 0 | 0 | 0 |
| 5 | 1 | 1 | 1 |
| 6 | 0 | 0 | 1 (held) |

# barrel_shifter8: 8-bit logical barrel shifter
## Function
Shifts an 8-bit word left or right by 0 to 7 positions in a single combinational step. Shifts are logical: vacated positions are filled with zeros and bits shifted out are lost. Built as three stages that shift by 1, 2 and 4.
## Parameters
| Name | Default | Meaning |
|---|---|---|
| (none) | | |
## Ports
| Port | Dir | Width | Description |
|---|---|---|---|
| data | input | 8 | Value to shift |
| shamt | input | 3 | Shift amount 0..7 |
| dir | input | 1 | Direction: 0 = left, 1 = right |
| dout | output | 8 | Shifted value |
## Behaviour
Purely combinational:
- `dir = 0`: `dout = (data << shamt) mod 256`, i.e. `dout[i] = data[i - shamt]` for `i >= shamt`, else 0.
- `dir = 1`: `dout = data >> shamt`, i.e. `dout[i] = data[i + shamt]` for `i + shamt <= 7`, else 0.
- `shamt = 0`: `dout = data` in both directions.

Every input combination is legal.
## Example
| data | shamt | dir | dout |
|---|---|---|---|
| 10110011 | 0 | 0 | 10110011 |
| 10110011 | 1 | 0 | 01100110 |
| 10110011 | 3 | 0 | 10011000 |
| 10110011 | 7 | 0 | 10000000 |
| 10110011 | 1 | 1 | 01011001 |
| 10110011 | 4 | 1 | 00001011 |
| 10110011 | 7 | 1 | 00000001 |

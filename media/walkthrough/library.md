# Start from the design library

**DV: New Design from Library** lists 106 designs by category:

| Category | Examples |
|---|---|
| Gates, arithmetic | AND…XNOR, adders, subtractors, multipliers, comparators |
| Mux, encoders, codes | mux/demux, priority encoder, 7-segment, Gray, parity, CRC, Hamming |
| Datapath | ALU with flags, barrel shifter, popcount, MAC |
| Sequential | flip-flops, shift registers, counters, LFSR, program counter |
| Memories, FIFOs | RAM, ROM, register file, synchronous FIFO, first-word-fall-through FIFO |
| State machines | traffic light, sequence detector, vending machine, arbiter |
| Protocols | APB, AHB-Lite, AXI4-Lite, AXI-Stream, Wishbone, SPI, I²C, UART |

You get:

- the RTL in `design/`;
- `SPEC.md`;
- the generated testbenches and test plan;
- the design's own self-check in `tb/selfcheck/`.

Run the regression, then change the RTL for your needs. The spec and the tests keep you honest.

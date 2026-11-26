# Example designs from tutorial sites

Four small designs that match well-known tutorial examples, so you can try the extension on code you may already know.

These are **original implementations** with the same interfaces and behaviour as the pages below. None of the pages grants a licence to redistribute its code (VLSI Verify states "Copyright © 2026 VLSI Verify"), so their code is not copied here.

| Folder | Behaviour taken from | Template picked automatically |
|---|---|---|
| `ripple_carry_adder/` | [VLSI Verify: ripple-carry adder](https://vlsiverify.com/verilog/verilog-codes/ripple-carry-adder/). `SIZE`-bit, full-adder chain; `Cout[SIZE-1:0]` is the carry out of every stage | adder (checks `S` and every stage's carry) |
| `dff/` | [ChipVerify: D flip-flop testbench](https://lab.chipverify.com/examples/d-flip-flop-testbench). Rising-edge capture, asynchronous active-low reset `rstn` | dff |
| `memory/` | [Verification Guide: memory model](https://verificationguide.com/systemverilog-examples/systemverilog-testbench-example-memory_m/). 4 × 8-bit, `wr_en` / `rd_en`, read data one cycle later, reset loads `'hFF` | memory |
| `counter_0_to_n/` | A counter from 0 to `N` that wraps to 0, with `N = 0` allowed | counter (`N` read from the parameter) |

## Try one

1. Open the design file, for example `memory/memory.sv`.
2. Run **DV: Select DUT**. The suggested template is already selected.
3. Run **DV: Generate Testbench** → **All**, then **DV: Run Regression**.
4. Run **DV: Open Dashboard**.

To sweep parameters, add configurations to `dvflow.json`. Every test then runs for each configuration:

```json
"configs": [ { "name": "size2", "params": { "SIZE": 2 } },
             { "name": "size4", "params": { "SIZE": 4 } },
             { "name": "size8", "params": { "SIZE": 8 } } ]
```

For the counter, use `{ "N": 0, "W": 4 }`, `{ "N": 9, "W": 4 }`, and so on.

## More places with designs to try

| Site | What it has |
|---|---|
| [HDLBits](https://hdlbits.01xz.net/) | Hundreds of small Verilog exercises (combinational, sequential, FSMs) with online checking |
| [Nandland](https://nandland.com/) | Adders, FIFOs, UART, SPI, debouncers, VGA; clean beginner RTL |
| [EDA Playground](https://www.edaplayground.com/) | Thousands of shared Verilog / SystemVerilog / UVM examples you can run in the browser |
| [Verification Academy](https://verificationacademy.com/) | UVM cookbook and methodology examples |
| [ASIC World](http://www.asic-world.com/examples/verilog/index.html) | Classic Verilog examples: counters, encoders, memories, FIFOs, arbiters |
| [ZipCPU blog](https://zipcpu.com/) | FIFOs, AXI, UART and formal verification walkthroughs |
| [OpenCores](https://opencores.org/projects) | Larger open-source IP: UARTs, I²C, SPI, CPUs; check each project's licence |
| [Project F](https://projectf.io/) | FPGA RTL tutorials and a reusable library |
| [FPGA4student](https://www.fpga4student.com/) | Verilog / VHDL projects with testbenches: ALU, FIFO, RISC processor |

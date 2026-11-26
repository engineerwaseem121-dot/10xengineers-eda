# Sign-off: synthesis, gate-level simulation, equivalence, formal

**DV: Sign-off Check** runs these steps in one go. Each one is also its own command.

| Step | What it tells you |
|---|---|
| **Lint** | Verilator `-Wall` findings in the DUT, linked to the line |
| **Synthesis** (`DV: Synthesize DUT`) | Cells, flip-flops, **inferred latches** with the signal names, logic depth, and design problems (undriven nets, multiple drivers, loops). Writes a gate netlist you can open as a schematic. |
| **Logic equivalence** | A formal check that the gate netlist does exactly what the RTL does |
| **Gate-level simulation** (`DV: Gate-Level Simulation`) | Your testbench, re-run on the netlist (Icarus or Verilator), with its own dashboard |
| **Formal proof** (`DV: Formal Proof`) | The DUT is proven equal to the reference model **for every input sequence**, not just the tests you ran. Every coverage bin becomes a formal cover, so you learn which bins can never happen. A failure comes with a counterexample waveform. |

You don't write any properties: the formal harness is generated from the same behaviour spec the testbenches use. Everything runs on open-source tools (Yosys, SymbiYosys with Z3, Verilator, Icarus) in the Docker toolchain.

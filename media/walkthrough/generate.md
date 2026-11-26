# Generate the testbenches

**DV: Generate Testbench** → **Both** creates:

| Path | What it is |
|---|---|
| `tb/` | Self-checking SystemVerilog testbench: directed, boundary, exhaustive and random tests |
| `uvm/` | Full UVM environment: agent, driver, monitor, scoreboard, coverage, sequences and tests |
| `cocotb/` | Python testbench: a reference model and cocotb tests (choose **cocotb** or **All**) |
| `testplan.yaml` | Requirements → scenarios → checks, with stable IDs |

Every testbench uses the same scenario IDs and requirements, so their results can be compared one to one. Each one gets the full dashboard: SV regressions, UVM runs and cocotb runs. Regenerating keeps your edits to the test plan.

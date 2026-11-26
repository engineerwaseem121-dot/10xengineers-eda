# Run tests and regressions

- **DV: Run Test:** pick the testbench (simple or UVM), the simulator, a test, a seed and the number of runs.
- **DV: Run Regression:** a whole suite across several seeds.

| Simulator | Simple TB | UVM | Code coverage |
|---|---|---|---|
| Icarus | ✓ | | |
| Verilator | ✓ | ✓ | ✓ line, branch, toggle |
| Questa | ✓ | ✓ | ✓ including covergroups |
| VCS | ✓ | ✓ | ✓ |

Turn on **code coverage** to get a list of DUT lines and conditions that no test exercised. Every run also updates `testplan.yaml` and `testplan.xlsx` with its results.

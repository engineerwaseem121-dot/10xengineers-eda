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

## In pictures

The numbered labels on each picture are explained in its top bar.

**A failing run: log and waveform side by side**

![A failing run: log and waveform side by side](../../images/demo/02-run-panel-log-waveform.png)

**Coverage after a Verilator run with code coverage on**

![Coverage after a Verilator run with code coverage on](../../images/demo/04-coverage.png)

**Waveform viewer with a protocol decoder and transaction table**

![Waveform viewer with a protocol decoder and transaction table](../../images/demo/07-waveform-decoders.png)

**X-trace: from an X on an output back to the line that causes it**

![X-trace: from an X on an output back to the line that causes it](../../images/demo/08-xtrace-rtl.png)

# Open-source tools in a container

The extension runs these tools from a Docker image, so you don't install them one by one:

| Tool | Used for |
|---|---|
| Icarus Verilog | Simple testbenches |
| Verilator 5.054 + UVM | Fast simulation, code coverage, UVM |
| Yosys, SymbiYosys | Schematics, formal, equivalence checks |
| Python with cocotb, pyuvm | Python testbenches |

**What you need:** Docker Desktop, or Docker Engine inside WSL on Windows. The setup command explains both.

When the bottom-left status bar shows **EDA: auto**, the tools are ready. Tools installed on your machine are still used first. Commercial simulators (Questa, VCS) always run from your own installation.

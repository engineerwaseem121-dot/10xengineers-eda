# The simulation tools download by themselves

You only need **Docker**: Docker Desktop on Windows or macOS, or Docker Engine on Linux or inside WSL. Start it once.

The first run that needs a tool downloads one image with all of them (about 1.2 GB, with progress in *Output → 10xEngineers EDA*), checks every tool, and reuses it after that:

| Tool | Used for |
|---|---|
| Icarus Verilog 12 | Simple testbenches |
| Verilator 5.054 + UVM | Fast simulation, code coverage, UVM with no license |
| Yosys, SymbiYosys | Schematics, synthesis, formal proofs, equivalence checks |
| Python with cocotb 2.1, pyuvm | Python testbenches |

- Tools installed on your machine are used first. Questa and VCS always run from your own installation.
- **DV: Check Tools** shows what was found, the versions and the licence status.
- **Update Simulation Tools** moves to a newer image, and checks it first.

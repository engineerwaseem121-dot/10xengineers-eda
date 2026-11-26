# Third-party software in the 10xEngineers EDA tools image

The image `ghcr.io/engineerwaseem121-dot/eda-tools` bundles the open-source programs below, unmodified.

- **Licence texts:** the full text of each licence is inside the image, under `/usr/share/doc/<package>/copyright` for Ubuntu packages and next to the sources for the others.
- **Ubuntu packages:** sources are at https://launchpad.net/ubuntu/+source/<package>.
- **The other components:** sources are at the repositories listed below.
- **Written offer:** for the GPL components, the corresponding source for the exact versions in an image can also be requested from the publisher of that image.

| Component | Version in image 1.0.0 | Licence | Source |
|---|---|---|---|
| Ubuntu base | 24.04 (`ubuntu@sha256:562111b8…`) | Various (see `/usr/share/doc/*/copyright`) | https://ubuntu.com |
| Icarus Verilog | 12.0 (Ubuntu `12.0-2build2`) | GPL-2.0-or-later | https://github.com/steveicarus/iverilog |
| Verilator | 5.054 (official `verilator/verilator:v5.054` image) | LGPL-3.0-only or Artistic-2.0 | https://github.com/verilator/verilator |
| UVM for Verilator | chipsalliance/uvm-verilator `5d72b661` | Apache-2.0 | https://github.com/chipsalliance/uvm-verilator |
| GHDL | 4.1.0 (Ubuntu `4.1.0+dfsg-0ubuntu2.1`) | GPL-2.0-or-later | https://github.com/ghdl/ghdl |
| Yosys | 0.33 (Ubuntu `0.33-5build2`) | ISC | https://github.com/YosysHQ/yosys |
| SymbiYosys | `yosys-0.33` | ISC | https://github.com/YosysHQ/sby |
| Z3 | 4.8.12 | MIT | https://github.com/Z3Prover/z3 |
| Boolector | 1.5.118 | MIT | https://github.com/Boolector/boolector |
| GTKWave (fst2vcd / vcd2fst only) | 3.3.116 | GPL-2.0-or-later | https://github.com/gtkwave/gtkwave |
| GNU Make | 4.3 | GPL-3.0-or-later | https://www.gnu.org/software/make/ |
| GCC / g++ | 13.2 | GPL-3.0-or-later with the GCC Runtime Library Exception | https://gcc.gnu.org |
| Python | 3.12.3 | PSF-2.0 | https://www.python.org |
| cocotb | 2.1.0 | BSD-3-Clause | https://github.com/cocotb/cocotb |
| cocotb-bus | 0.3.0 | BSD-3-Clause | https://github.com/cocotb/cocotb-bus |
| pyuvm | 5.0.0 | Apache-2.0 | https://github.com/pyuvm/pyuvm |
| pytest | 9.2.0 | MIT | https://github.com/pytest-dev/pytest |
| PyYAML | 6.0.4 | MIT | https://github.com/yaml/pyyaml |

The extension starts these programs inside the container. It does not link or ship any of them itself. Exact versions are recorded in `/etc/tenx-eda-tools.json` inside every image, and shown by **Open-Source Toolchain: Status**.

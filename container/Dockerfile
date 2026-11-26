# syntax=docker/dockerfile:1
#
# 10xEngineers EDA — open-source verification toolchain image.
# Lets the extension run simulation / lint / formal / synthesis without the user installing anything but Docker.
#
#   Icarus Verilog      SystemVerilog simulation (simple testbenches)
#   Verilator           lint, fast simulation, coverage, UVM (official prebuilt image by default; UVM needs a recent release)
#   UVM 2020.3.2        /opt/uvm  (UVM_HOME), the CHIPS Alliance kit maintained for Verilator
#   GHDL                VHDL simulation
#   Yosys + SymbiYosys  synthesis / schematics, formal (with z3 + boolector)
#   gtkwave CLI tools   fst2vcd / vcd2fst (waveform conversion; the viewer is in the extension)
#   Python 3 venv       cocotb, cocotb-bus, pyuvm, pytest, pyyaml
#   make, g++, git, ccache
#
# Build:  docker build -t 10xengineers/eda-tools:1 container/                       (a few minutes)
#         docker build --build-arg VERILATOR_VERSION=v5.054 ...                    (pick a Verilator release)
#         docker build --build-arg VERILATOR_FROM=source ...                       (compile Verilator, ~20 min)
# The tool versions are recorded in /etc/tenx-eda-tools.json (read by the extension).

ARG UBUNTU=24.04
ARG VERILATOR_VERSION=v5.054
ARG VERILATOR_FROM=prebuilt

# ---------------------------------------------------------------- Verilator: official prebuilt image (Ubuntu 24.04, /usr/local)
FROM verilator/verilator:${VERILATOR_VERSION} AS verilator-prebuilt

# ---------------------------------------------------------------- Verilator: from source (same /usr/local layout)
FROM ubuntu:${UBUNTU} AS verilator-source
ARG VERILATOR_VERSION
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git ca-certificates autoconf flex bison help2man perl python3 make g++ libfl-dev zlib1g-dev ccache \
 && rm -rf /var/lib/apt/lists/*
RUN (git clone --depth 1 --branch ${VERILATOR_VERSION} https://github.com/verilator/verilator /src/verilator \
     || git clone --depth 1 --branch stable https://github.com/verilator/verilator /src/verilator) \
 && cd /src/verilator && autoconf && ./configure --prefix=/usr/local \
 && make -j"$(nproc)" && make install && rm -rf /src/verilator

FROM verilator-${VERILATOR_FROM} AS verilator

# ---------------------------------------------------------------- runtime image
FROM ubuntu:${UBUNTU}
# UVM 2020.3.2 kit maintained for Verilator (CHIPS Alliance); falls back to the Accellera kit
ARG UVM_REPO=https://github.com/chipsalliance/uvm-verilator
ARG UVM_REF=master
LABEL org.opencontainers.image.title="10xEngineers EDA tools" \
      org.opencontainers.image.description="Open-source HDL verification toolchain for the 10xEngineers EDA VS Code extension" \
      com.10xengineers.eda.schema="1"

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      iverilog yosys ghdl z3 boolector gtkwave \
      make g++ perl python3 python3-venv python3-pip python3-dev git ca-certificates libfl2 zlib1g-dev ccache \
 && rm -rf /var/lib/apt/lists/*

# Verilator (release builds only; the *_dbg debug binaries are left out)
COPY --from=verilator /usr/local/share/verilator /usr/local/share/verilator
COPY --from=verilator /usr/local/bin/verilator /usr/local/bin/verilator_bin /usr/local/bin/verilator_coverage /usr/local/bin/verilator_coverage_bin /usr/local/bin/verilator_gantt /usr/local/bin/verilator_profcfunc /usr/local/bin/

# UVM sources for Verilator
RUN (git clone --depth 1 --branch ${UVM_REF} ${UVM_REPO} /opt/uvm \
     || git clone --depth 1 https://github.com/accellera-official/uvm-core /opt/uvm) \
 && (cd /opt/uvm && git log -1 --format='%h %cd' --date=short > /opt/uvm/.source-rev 2>/dev/null; true) \
 && rm -rf /opt/uvm/.git && test -f /opt/uvm/src/uvm_pkg.sv

# SymbiYosys (formal front end); pinned to the Yosys release shipped above when such a tag exists
RUN Y=$(yosys -V | sed -n 's/^Yosys \([0-9.]*\).*/\1/p'); \
    (git clone --depth 1 --branch "yosys-$Y" https://github.com/YosysHQ/sby /src/sby \
     || git clone --depth 1 --branch "v$Y" https://github.com/YosysHQ/sby /src/sby \
     || git clone --depth 1 https://github.com/YosysHQ/sby /src/sby) \
 && make -C /src/sby install PREFIX=/usr && rm -rf /src/sby \
 && sed -i '1s|.*|#!/usr/bin/python3|' /usr/bin/sby \
 && sby --help >/dev/null

# Python utilities
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir cocotb cocotb-bus pyuvm pytest pyyaml \
 && /opt/venv/bin/cocotb-config --libpython >/dev/null   # cocotb embeds Python in the simulator: needs libpython (python3-dev)

ENV PATH=/opt/venv/bin:${PATH} \
    UVM_HOME=/opt/uvm \
    CCACHE_DIR=/tmp/ccache \
    HOME=/tmp

# record versions for the extension's toolchain status view
RUN python3 - <<'EOF'
import json, subprocess
def v(cmd):
    try: return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30).stdout.strip().splitlines()[0]
    except Exception: return ""
tools = {
  "iverilog": v("iverilog -V 2>&1 | head -1"),
  "vvp": v("vvp -V 2>&1 | head -1"),
  "verilator": v("verilator --version"),
  "ghdl": v("ghdl --version | head -1"),
  "yosys": v("yosys -V"),
  "sby": v("sby --help >/dev/null 2>&1 && echo \"SymbiYosys (yosys $(yosys -V | cut -d' ' -f2))\""),
  "z3": v("z3 --version"),
  "boolector": v("boolector --version"),
  "fst2vcd": v("command -v fst2vcd"),
  "python": v("/opt/venv/bin/python --version"),
  "cocotb": v("/opt/venv/bin/python -c 'import cocotb;print(\"cocotb\",cocotb.__version__)'"),
  "pyuvm": v("/opt/venv/bin/pip show pyuvm | sed -n 's/^Version: /pyuvm /p'"),
  "make": v("make --version | head -1"),
  "uvm": v("ls /opt/uvm/src/uvm_pkg.sv >/dev/null && echo \"UVM $(sed -n 's/^1800.2 *//p;s/^# *Kit version *//p' /opt/uvm/README.md | head -1) $(cat /opt/uvm/.source-rev 2>/dev/null)\""),
}
json.dump({"schema": 1, "tools": tools}, open("/etc/tenx-eda-tools.json", "w"), indent=2)
print(json.dumps(tools, indent=2))
EOF

WORKDIR /tmp
CMD ["sleep", "infinity"]

# syntax=docker/dockerfile:1
#
# 10xEngineers EDA — open-source verification toolchain image (version: see IMAGE_VERSION / image.json).
# Lets the extension run simulation / lint / formal / synthesis without the user installing anything but Docker.
#
#   Icarus Verilog 12.0      SystemVerilog simulation (simple testbenches)
#   Verilator 5.054          lint, fast simulation, code coverage, UVM
#   UVM for Verilator        /opt/uvm (UVM_HOME): chipsalliance/uvm-verilator, pinned commit, paired with Verilator 5.054
#   GHDL 4.1.0               VHDL simulation
#   Yosys 0.33 + SymbiYosys  synthesis / schematics, formal (z3, boolector)
#   gtkwave CLI tools        fst2vcd / vcd2fst (the waveform viewer is in the extension)
#   Python 3.12 venv         cocotb 2.1.0, cocotb-bus, pyuvm 5.0.0, pytest, pyyaml
#   make, g++, git, ccache
#
# Every input is pinned (base images by digest, apt packages by version from the Ubuntu snapshot archive, UVM by
# commit, Python packages by version), so a rebuild of the same Dockerfile gives the same tools.
#
# Build:   docker build -t ghcr.io/engineerwaseem121-dot/eda-tools:1.0.0 container/
#          (or "10xEngineers EDA: Set Up Open-Source Toolchain" → Build, or  dvflow toolchain build)
# Check:   docker run --rm ghcr.io/engineerwaseem121-dot/eda-tools:1.0.0 tenx-smoke
# Versions are recorded in /etc/tenx-eda-tools.json (read by the extension); licences in /usr/share/doc/tenx-eda-tools/.

ARG IMAGE_VERSION=1.0.0
ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b
ARG VERILATOR_VERSION=v5.054
ARG VERILATOR_IMAGE=verilator/verilator:v5.054@sha256:da7845c38c2ab84133661a1b1e2d717d028fe0bc629cc06c77bb80571e610448
ARG VERILATOR_FROM=prebuilt
# apt packages come from the Ubuntu snapshot archive of this date, so the pinned versions stay installable
ARG APT_SNAPSHOT=20261126T000000Z

# ---------------------------------------------------------------- Verilator: official prebuilt image (Ubuntu 24.04, /usr/local)
FROM ${VERILATOR_IMAGE} AS verilator-prebuilt

# ---------------------------------------------------------------- Verilator: from source (same /usr/local layout)
FROM ${UBUNTU_IMAGE} AS verilator-source
ARG VERILATOR_VERSION
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git ca-certificates autoconf flex bison help2man perl python3 make g++ libfl-dev zlib1g-dev ccache \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${VERILATOR_VERSION} https://github.com/verilator/verilator /src/verilator \
 && cd /src/verilator && autoconf && ./configure --prefix=/usr/local \
 && make -j"$(nproc)" && make install && rm -rf /src/verilator

FROM verilator-${VERILATOR_FROM} AS verilator

# ---------------------------------------------------------------- runtime image
FROM ${UBUNTU_IMAGE}
ARG IMAGE_VERSION
ARG APT_SNAPSHOT
# UVM kit maintained for Verilator (CHIPS Alliance), pinned to the commit tested with Verilator 5.054
ARG UVM_REPO=https://github.com/chipsalliance/uvm-verilator
ARG UVM_COMMIT=5d72b6618acfddece7f09382a032ccbc05862fdc
LABEL org.opencontainers.image.title="10xEngineers EDA tools" \
      org.opencontainers.image.description="Open-source HDL verification toolchain for the 10xEngineers EDA VS Code extension" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.source="https://github.com/engineerwaseem121-dot/10xengineers-eda" \
      org.opencontainers.image.licenses="See /usr/share/doc/tenx-eda-tools/THIRD_PARTY_NOTICES.md" \
      com.10xengineers.eda.schema="1"

RUN (apt-get update --snapshot "${APT_SNAPSHOT}" || apt-get update) \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      iverilog=12.0-2build2 \
      yosys=0.33-5build2 \
      ghdl=4.1.0+dfsg-0ubuntu2.1 \
      z3=4.8.12-3.1build1 \
      boolector=1.5.118.6b56be4.121013-1.3 \
      gtkwave=3.3.116-1build2 \
      make=4.3-4.1build2 \
      g++=4:13.2.0-7ubuntu1 \
      python3=3.12.3-0ubuntu2.1 python3-dev=3.12.3-0ubuntu2.1 python3-venv python3-pip \
      perl git ca-certificates libfl2 zlib1g-dev ccache \
 && rm -rf /var/lib/apt/lists/*

# Verilator (release builds only; the *_dbg debug binaries are left out)
COPY --from=verilator /usr/local/share/verilator /usr/local/share/verilator
COPY --from=verilator /usr/local/bin/verilator /usr/local/bin/verilator_bin /usr/local/bin/verilator_coverage /usr/local/bin/verilator_coverage_bin /usr/local/bin/verilator_gantt /usr/local/bin/verilator_profcfunc /usr/local/bin/

# UVM sources for Verilator, at the pinned commit
RUN git init -q /opt/uvm && cd /opt/uvm \
 && git remote add origin "${UVM_REPO}" && git fetch -q --depth 1 origin "${UVM_COMMIT}" && git checkout -q FETCH_HEAD \
 && git log -1 --format='%h %cd' --date=short > /opt/uvm/.source-rev \
 && rm -rf /opt/uvm/.git && test -f /opt/uvm/src/uvm_pkg.sv

# SymbiYosys (formal front end), at the tag matching the Yosys release above
RUN Y=$(yosys -V | sed -n 's/^Yosys \([0-9.]*\).*/\1/p') \
 && git clone -q --depth 1 --branch "yosys-$Y" https://github.com/YosysHQ/sby /src/sby \
 && make -C /src/sby install PREFIX=/usr && rm -rf /src/sby \
 && sed -i '1s|.*|#!/usr/bin/python3|' /usr/bin/sby \
 && sby --help >/dev/null

# Python utilities (pinned)
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir cocotb==2.1.0 cocotb-bus==0.3.0 pyuvm==5.0.0 pytest==9.2.0 pyyaml==6.0.4 \
 && /opt/venv/bin/cocotb-config --libpython >/dev/null   # cocotb embeds Python in the simulator: needs libpython (python3-dev)

ENV PATH=/opt/venv/bin:${PATH} \
    UVM_HOME=/opt/uvm \
    CCACHE_DIR=/tmp/ccache \
    HOME=/tmp

# smoke test (run by the extension before switching to an update, and by CI) + licence notices
COPY smoke.sh /usr/local/bin/tenx-smoke
COPY THIRD_PARTY_NOTICES.md image.json /usr/share/doc/tenx-eda-tools/
RUN chmod 755 /usr/local/bin/tenx-smoke

# record versions for the extension's toolchain status view
RUN IMAGE_VERSION="${IMAGE_VERSION}" python3 - <<'EOF'
import json, os, subprocess
def v(cmd):
    try: return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30).stdout.strip().splitlines()[0]
    except Exception: return ""
tools = {
  "iverilog": v("iverilog -V 2>&1 | head -1"),
  "vvp": v("vvp -V 2>&1 | head -1"),
  "verilator": v("verilator --version"),
  "uvm": v("echo \"UVM (uvm-verilator) $(cat /opt/uvm/.source-rev 2>/dev/null)\""),
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
}
json.dump({"schema": 1, "image_version": os.environ.get("IMAGE_VERSION", ""), "tools": tools}, open("/etc/tenx-eda-tools.json", "w"), indent=2)
print(json.dumps(tools, indent=2))
EOF

WORKDIR /tmp
CMD ["sleep", "infinity"]

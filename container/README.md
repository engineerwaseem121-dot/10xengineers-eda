# Open-source toolchain in a container

The extension can run the open-source tools from a container image, so you don't need to install them yourself:

| Tool | Used for |
|---|---|
| Icarus Verilog | Simple (lightweight) testbenches |
| Verilator | Lint, fast simulation, code coverage, UVM |
| Accellera UVM library | UVM testbenches on Verilator (`/opt/uvm`) |
| GHDL | VHDL simulation |
| Yosys + SymbiYosys (z3, boolector) | Schematics, formal verification |
| gtkwave CLI tools | FST ↔ VCD conversion |
| Python: cocotb, pyuvm, pytest | Python testbenches |
| make, g++, git | Makefile flows |

Commercial simulators (Questa, VCS) always run from your own installation.

## 1. Install a container engine

Use **one** of these.

### Windows: Docker Engine inside WSL (no Docker Desktop)

In PowerShell:

```powershell
wsl --install -d Ubuntu-24.04      # skip if you already have an Ubuntu WSL distro
```

Then, in the Ubuntu terminal:

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
sudo usermod -aG docker $USER
```

Back in PowerShell, run `wsl --shutdown` once so the group change takes effect.

### Windows or macOS: Docker Desktop

Install it from <https://docs.docker.com/desktop/>. Companies with more than 250 employees or more than $10M revenue need a paid Docker subscription.

### Linux

Install Docker Engine (<https://docs.docker.com/engine/install/>) or Podman, and add yourself to the `docker` group.

## 2. The image

Nothing to do: the first run that needs a tool downloads `ghcr.io/engineerwaseem121-dot/eda-tools:<version>` (the version pinned in [image.json](image.json)), smoke-tests it and uses it. Progress is in *Output → 10xEngineers EDA*. **10xEngineers EDA: Update Simulation Tools** checks for a newer compatible image.

Other options, in **10xEngineers EDA: Set Up Open-Source Toolchain (Docker)**:

- **Build the image** on your machine from the Dockerfile in this folder (about 15 minutes, once, about 2.5 GB), for example when you are offline.
- **Use your own image:** set `tenxDebug.toolchain.image`, for example `ghcr.io/<org>/eda-tools:1.2.0`. The extension then neither updates nor replaces it.

From a terminal: `dvflow toolchain pull` (download now), `dvflow toolchain update`, `dvflow toolchain smoke`, `dvflow toolchain status`, `dvflow toolchain build`.

## 3. Use it

Nothing else changes. In the default **auto** mode, the extension uses a tool installed on your machine when it finds one, and the container otherwise. Every place that runs a tool works this way:

- DV: Run Test, Run Regression and Doctor
- UVM on Verilator
- Lint
- Schematics
- Formal

Settings:

| Setting | What it does |
|---|---|
| `tenxDebug.toolchain.mode` | `auto` (default), `container` (always use the image) or `local` (never use it) |
| `tenxDebug.toolchain.engine` | `auto`, `docker`, `wsl` or `podman` |
| `tenxDebug.toolchain.mounts` | Extra folders the tools can read and write |

Your workspace folders, the temp folder and `~/.dvflow` are always mounted, at the same path in Linux form (`C:\work\chip` becomes `/mnt/c/work/chip`). Logs and results therefore land in your project as usual.

**Open-Source Toolchain: Open Terminal in Container** gives you a shell with `make`, `python`/cocotb, `verilator` and the other tools.

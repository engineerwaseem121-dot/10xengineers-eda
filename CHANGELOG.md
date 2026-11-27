# Changelog

## 0.17.1
- **The tools image is published:** `ghcr.io/engineerwaseem121-dot/eda-tools:1.0.0` is public. A new user with only Docker installed gets it automatically on the first run (tested: download, smoke test, SV, UVM and cocotb runs).
- **cocotb in folders with spaces** (for example `My Projects`): the generated Makefile and the results file now use paths relative to `cocotb/`, because GNU make splits paths at spaces. Regenerate the cocotb testbench to get it.

## 0.17.0
- **A standard project structure.** `design/` for the RTL, `testplan/` for `testplan.yaml` and `testplan.xlsx`, `tb/`, `cocotb/`, and a UVM environment split into `uvm/tb`, `agent`, `sequences`, `env`, `tests` and `scripts`. See *Project structure* in the README.
  - **DV: Select DUT** offers *Move RTL to design/* when the RTL sits in the project folder (open editors follow, and `dvflow.json` is updated).
  - Older projects are reorganised on the next **DV: Generate Testbench**: the plan moves to `testplan/`, the UVM files go into their folders, and the old flat UVM files are kept in `uvm/_old_flat_layout/`. Until then everything still works from the old places.
  - The UVM Questa scripts (`uvm/scripts/run.do`, `Makefile`, `run.sh`, `run.bat`) compile from `uvm/` with `files.f`.
- **cocotb:** a free-running counter (no enable) was checked one cycle late after reset (`expected 1 got 2`), so correct designs failed. The first step after reset now drives on the same edge the reset ended on. Regenerate the cocotb testbench to get the fix.

## 0.16.1
- **Every run updates the test plan.** UVM and cocotb runs (DV: Run Test → UVM / cocotb) now write the results block of `testplan.yaml` and refresh `testplan.xlsx`, like the SV regressions. Before, they updated only the dashboard.
- **Waveforms for failures, automatically.** The new default waveform mode is *only if the test fails*. Passing runs stay fast with no dump. A failing run is repeated once with the same seed and the waveform on, so `waves.vcd` is in the run folder, in the failure folder and in the dashboard. This applies to single runs, regressions and UVM.
  - **DV: Run Test** asks: *Only if the test fails* (recommended), *Always* or *Never*. Command line: `--waves fail|1|0`; `make WAVES=fail|1|0`.
  - Generated UVM `tb_top` dumps only with `+WAVES`. Regenerate the UVM testbench to get it; older ones still dump on every run.

## 0.16.0
- **Docker works on the first run for new users.** Install Docker, install the extension, press Run.
  - The pinned tools image (`ghcr.io/engineerwaseem121-dot/eda-tools:1.0.0`) downloads by itself the first time a tool is needed, with progress in the Output panel. Cancel stops it. Two VS Code windows share one download.
  - Every image is smoke-tested before it is used (Icarus, Verilator, UVM, Yosys, SymbiYosys, GHDL, cocotb). A failing image is never used; the last working one is kept.
  - **10xEngineers EDA: Update Simulation Tools** and a daily check (`tenxDebug.toolchain.autoUpdate`) move to newer compatible images, the same way.
  - Specific messages for: Docker not installed, not running, no permission, offline or proxy, image private or not published, disk full.
  - Each run logs the image tag and tool versions. Modes: `auto`, `container`, `local`.
  - Pinned tool versions in `container/image.json`, licences in `container/THIRD_PARTY_NOTICES.md`, smoke test `tenx-smoke` in the image.
  - CI builds and smoke-tests the image; publishing is a separate workflow (`publish-image.yml`).
- **Projects in folders with spaces** run in Docker (Icarus and Verilator). Verilator's Makefile cannot build in such folders, so in Docker it builds inside the container.
- **UVM: the monitor reads reset through its clocking block.** It used to read reset directly, which raced with reset release on the same clock edge: on some simulators (Questa, Verilator) the reference model counted one cycle too early, and every check of a counter failed (`expected count=1, actual count=0`). Regenerate the UVM testbench to get the fix.
- **Mod-N counters:** `mod10_counter`, `counter_mod6`, `decade_counter` and `bcd_counter` are modelled as counting 0..N-1 (from the module name, when there is no `N` / `MOD` parameter).
- **DV: Doctor is now DV: Check Tools** (`make check-tools`, `dvflow check-tools`; the old names still work).
- Fixed: a UVM run on Verilator did not write its dashboard ("cov is not defined").
- Update checks report an unreachable registry as such, instead of "up to date".
- README: a 4-step get-started guide, a troubleshooting table, a flow diagram, a Docker first-run diagram, and new pictures (Excel test plan viewer, Docker first run).

## 0.15.2
- **UVM waveforms show the interface signals on every simulator.** Questa, VCS and Xcelium do not write SystemVerilog interface contents to a VCD file. The generated `tb_top` now mirrors every interface signal into plain wires under `tb_top.<name>_if_signals`, so they appear in `waves.vcd`. Verilator already dumped the interface, so the mirror is skipped there. Regenerate the UVM testbench (**DV: Generate Testbench → UVM**) to get it.
- **Split buses are regrouped in the waveform viewer.** When a dump writes a bus as separate bits (`wr_data[7]` … `wr_data[0]`, as Questa does for nets driven through an interface), the viewer shows one bus `wr_data[7:0]` with hex values, as it already did for `rd_data`. Only contiguous bits with no real bus of the same name are merged.

## 0.15.1
- **UVM on Questa: functional coverage now shows in the dashboard.** Newer Questa versions print the Covergroups row with `na` in the Hits and Misses columns. That row was skipped, so the dashboard showed only code coverage while the UCDB / HTML report had the covergroups. Fixes:
  - Covergroups are read from that row, from the `TYPE …` lines of the detailed report, and from the Covergroup Bins row.
  - The **Functional** panel of a UVM run shows the covergroup bins (hit / total). The covergroup panel lists each covergroup type.
- **Coverage choice: Functional + code / Functional only / Code only.** What you pick is what is collected and shown.
  - The panel you didn't ask for says "not requested" instead of a misleading "unavailable".
  - On Questa UVM, *functional only* skips the code instrumentation (`+cover` / `-coverage`) but still saves the UCDB for the covergroups. Before this, "functional only" wrote no UCDB, so no covergroups were reported at all.
  - Command line: `--cov both|code|functional|none`; `1` and `0` still work.
- Removed a leftover note that named `adder4_cg` on every design.

## 0.15.0
- **Memory / RAM template.** Single-port memories are detected by their address port; before this, a RAM with `wr_en` / `rd_en` was mistaken for a FIFO and every test failed.
  - Covers: write then read every address; the first and last address with 00 / FF / AA / 55 patterns; the reset value (taken from a `RESET_VALUE` / `INIT_VALUE` parameter); read and write in the same cycle (old or new data); overwrites; random traffic.
  - Works with 1-cycle or combinational reads, in the SV testbench, UVM, cocotb and formal.
- **Counter:** the terminal count now comes from the design's `N` / `MAX` / `MOD` parameter. A `counter #(.N(9))` used to be modelled as 0..15.
- **Adder:** a carry port as wide as the operands (`Cout[SIZE-1:0]`, the carry out of every stage, as in many ripple-carry adders) is now checked. It used to be ignored silently.
- **CLI:** `--seeds 1` now means seed 1. It used to be read as a bare flag, and the default seeds ran.
- `examples/sites/`: ripple-carry adder, D flip-flop, memory and 0..N counter, matching the VLSI Verify, ChipVerify and Verification Guide tutorials (original code; source URLs recorded), plus a list of more sites with designs to try.

## 0.14.0
- **Excel viewer in VS Code.** `testplan.xlsx`, coverage workbooks and any other `.xlsx` open in a read-only tab. No Excel or separate viewer extension needed.
  - Sheet tabs with row counts, search (`/`), sort by any column, a sticky header and coloured status cells (PASS / FAIL / HOLE / NOT RUN …).
  - Paths of files and run folders are clickable. Summary sheets show as key/value lists.
  - **Copy** puts the visible rows on the clipboard as tab-separated text. **Open in Excel** and **Reveal** are also there.
  - The tab follows the file when a regression rewrites it.
  - Open it with **DV: View Test Plan (Excel) in VS Code**, **Excel: View in VS Code**, the right-click menu on `.xlsx`, or **View Excel plan** after generating a test plan.
  - Registered as an optional editor, so it never takes `.xlsx` away from the app you use by default.
- Dependency-free `.xlsx` reader: zip + SpreadsheetML, with shared and inline strings, numbers, booleans and cached formula results.

## 0.13.0
- **FIFO template.** Synchronous FIFOs are now verified out of the box instead of falling back to "custom".
  - Detected from the module name (`fifo`, `queue`) or its ports (full/empty, wr_en/rd_en).
  - Depth comes from `ADDR_WIDTH` / `DEPTH` or the count width; `behavior.depth` and `behavior.fwft` (first-word fall-through) can override.
  - The reference model checks full, empty, wr_ready, count, rd_valid and rd_data. There are 7 scenarios (write/read order, full + write while full, read while empty, read and write in the same cycle when empty, half full and full, pointer wrap, reset, random) and 9 coverage bins.
  - Works in the SV testbench, UVM (including Verilator), cocotb and formal. Formal runs a bounded check on a small instance of the same RTL (4 entries × 4 bits, 12 cycles), about a minute instead of hours.
- **Typographic quotes in the DUT** (`’0`, `1’b0`, curly double quotes, en dashes pasted from documents or chat) are reported with file:line:column before anything runs, instead of a cryptic compiler error. The error offers **Fix quotes**, and the new command **DV: Fix Typographic Quotes in DUT** does the same. Comments are ignored, and the fix can be undone.

## 0.12.4
- Published under the Marketplace publisher `WaseemAbbas`: the extension ID is `WaseemAbbas.10xengineer-eda`.
- README: the coverage dashboard, holes, analysis, testplan and waveform/FSM pictures are re-taken from the current build, with numbered labels. The old sidebar picture is replaced by the UVM architecture diagram. The example VCD header carries the current product name.
- CI: one small job (syntax check, unit tests, Icarus end-to-end with the Excel test plan, `.vsix` package). Tags `v*` publish a GitHub Release.

## 0.12.3
- **Demo in pictures.** 11 labelled screenshots in `images/demo/`, taken from a complete run on one design (`reg_32_bit.sv`). Each has numbered labels with an explanation bar. They appear in the README (*See it working*) and in the Welcome walkthrough steps (demo, dashboard, run, UVM, sign-off, quality).
- Fix: the run panel showed raw Markdown links (`[sim.log](sim.log)`) in the triage notes.
- Fix: X-trace showed raw simulation ticks (*unknown since 15000*); it now shows formatted times (*15 ns*).
- `package.json`: `repository` and `bugs` links.

## 0.12.2
- **testplan.xlsx is created together with testplan.yaml.** This applies to Generate Test Plan, Generate Testbench, `dvflow init` and `dvflow generate --yes`.
  - The workbook has Summary, Requirements, Scenarios, Coverage bins, Checkers and Tests sheets, marked NOT RUN until the first regression, which rewrites it with results.
  - If the plan is already up to date but the Excel file is missing, it is created.
  - Existing results are kept when the latest run covers every scenario.

## 0.12.1
- Marketplace listing: new display name, description, keywords and the Testing category.
- README: new opening, with *Why design-verification engineers switch*, *One extension instead of many* (what it covers, and what to keep alongside it), and a tip to disable overlapping extensions.

## 0.12.0
- **Waveform: SPI-Flash decoder** (on top of SPI). Gives one transaction per chip-select frame, with:
  - the opcode name (READ / FAST_READ / PAGE_PROGRAM / sector, block and chip erase / RDSR / RDID / 4-byte variants …), address, data, and the status bits WIP/WEL
  - an error flag on program, erase or WRSR sent without WREN
- **Waveform: RISC-V instruction-trace decoder** (clk, valid, pc, insn). Disassembles RV32I, M, Zicsr and the common compressed instructions, shows branches as taken or not taken, and flags illegal encodings. Roles are auto-mapped from RVFI / retire / trace names.
- **X-trace through RTL drivers.** Walks an X back through `assign`, `always` blocks (including their if/case conditions) and instance port connections to its origin. Each step links to file:line, and the origin comes with an explanation.
- **Cross-probe.** Right-click → *Go to declaration in RTL*. The opt-in `tenxDebug.wave.crossProbe.followWaveformSelection` setting follows the selection without taking focus. Ambiguous names are never guessed.
- **Contrast floor** for trace colours (`tenxDebug.wave.theme.minContrast`, default 3:1 WCAG), applied live on theme changes.
- **Large files.** VCDs are read in 4 MiB chunks, with a size ceiling (`tenxDebug.wave.maxFileMB`, default 256).
- **One-time prompt** to make the viewer the default for `*.vcd` when an editor opens it as text.
- **VHDL language id** for `.vhd` / `.vhdl`, so inline values work without a VHDL extension.
## 0.11.1
- **Seed ranges.** Run Test, Run Regression, UVM and cocotb prompts, and `--seeds` on the command line, accept one seed (`7`, the same stimulus again), lists (`1,5,9`), ranges (`0:100`, both ends included), stepped ranges (`0:100:10`), `random N` and mixes (`1,2,10:20,random 5`). The prompt validates while you type and shows how many runs it means. Seed 0 is valid. `--seed N --count M` still works.

## 0.11.0
- **Create Demo Project + Demo Tour.** One command creates a ready-made project (a 4-bit adder with SV, UVM and cocotb testbenches and a test plan) and opens a tour with one button per feature: toolchain, generated files, regression, dashboard, Verilator code coverage, UVM, cocotb, plant a bug, formal counterexample, fix and compare, mutation testing, sign-off. Each step explains what it does and why it matters, and runs with no prompts.
- **`dvflow init --file <rtl.sv>`** goes from an RTL file to `dvflow.json` and every testbench in one step (template guessed from the RTL; top module = the one nothing else instantiates).
- **README:** Quick start (5-minute demo), Step by step with your own design (each step with what you get and why it matters), Feature guide for 0.7–0.10, dvflow command line, updated command list.
- Getting Started walkthrough: new first step *Try the demo*.

## 0.10.0
- **Synthesis** (*DV: Synthesize DUT*): Yosys generic synthesis of the DUT reports cells, flip-flops, inferred latches with the signal names, logic depth and design problems (undriven nets, multiple drivers, loops), and writes a gate netlist (Verilog, plus JSON that opens as a schematic).
- **Gate-level simulation** (*DV: Gate-Level Simulation*): the SV testbench re-runs on the synthesized netlist (Icarus or Verilator), with its own dashboard (tagged *gls*; it never overwrites the RTL test plan).
- **Logic equivalence (LEC):** RTL vs netlist is proven formally. Yosys structural `equiv_*` comes first; for sequential designs whose flip-flops were renamed, a miter with temporal induction proves the outputs equal.
- **Formal proof with no hand-written properties** (*DV: Formal Proof*): a harness is generated from the template's reference model (`formal/<top>_formal.sv`, `formal/<top>.sby`), with one assertion per checked output and one cover per coverage bin. SymbiYosys proves the DUT equals the spec for every input sequence (k-induction), names the failing output with a counterexample waveform, and reports which coverage bins are reachable.
- **DV: Sign-off Check** runs lint (Verilator -Wall), synthesis, LEC, gate-level simulation and formal in one go: a checklist report (`runs/<id>-signoff/signoff.html`), a *Sign-off* panel on the dashboard Overview, and `dvflow signoff` on the command line.
- Generated UVM / cocotb / SV testbenches unchanged; walkthrough step added.

## 0.9.0
- **Dashboard for UVM runs.** Every UVM run (any simulator) now gets the same dashboard as a regression: runs with scoreboard check counts, log and waveform, scenarios and requirements (UVM tests mapped to the test plan), failures, History and Compare, plus Rerun from the run panel. Questa covergroup and code coverage show in Coverage.
- **cocotb (Python) testbench generator.** *DV: Generate Testbench → cocotb* (or *All*) writes `cocotb/test_<top>.py` with a Python reference model for each template (adder, counter, up/down counter, register, latch, shift register, pipeline; a fill-in skeleton for custom), tests with the same names and scenario IDs as the SV and UVM testbenches, and a Makefile for Icarus or Verilator.
- **Run cocotb from VS Code:** *DV: Run Test → cocotb testbench*. It runs in the Docker toolchain (or a local cocotb), one test and seed per run, and opens the dashboard. CLI: `dvflow cocotb`, `dvflow generate --mode cocotb|all`.
- Toolchain image: adds `python3-dev`. cocotb needs libpython to embed Python in the simulator; before this it was installed but could not run.

## 0.8.0
- **Mutation testing (DV: Mutation Test / `dvflow mutate`)** measures testbench quality. It plants small bugs in copies of the DUT (operator swaps, flipped constants, edge changes, dropped inversions), runs the regression on each, and reports the share caught. Survivors are formally checked with Yosys, so a mutant that is logically identical to the original is marked *equivalent* instead of being reported as a testbench hole. The report links each mutant to its line; the dashboard Overview gets a *Testbench quality* panel.
- **Verilator code coverage:** with coverage on, the `coverage.dat` of every run is merged (`verilator_coverage`) into line, branch, expression and toggle coverage for the DUT files, a list of uncovered DUT lines with what was missed there (clickable in the dashboard), annotated sources and LCOV. Works in the Docker toolchain, so code coverage no longer needs a commercial license.
- **Getting Started walkthrough** (Welcome page → *10xEngineers EDA: from one RTL file to a verified design*): seven steps with a button each, from toolchain setup to mutation testing.
- Standalone HTML reports (mutation testing) open in an editor panel whose links jump to the source line.

## 0.7.3
- Fixed: picking the DUT file again as a dependency in **DV: Select DUT** listed it twice and every simulator failed with "module already declared". Duplicates are now removed, also in existing `dvflow.json` files.
- Fixed: a project with no coverage bins (the "custom" template) generated a `case` with two `default` items, which Verilator rejects.
- A "custom" project whose reference model is still the placeholder now stops before simulating, and says how to fix it, instead of failing every check.

## 0.7.2
- **Dashboard: History tab.** Pass-rate and coverage trend across every run in runs/ (simple TB and UVM, all simulators), with filters by simulator, testbench and full suites. Runs that executed nothing (for example licence-blocked) show as markers instead of 0%. Click a point to open that run.
- **Compare runs:** newly failing, fixed and unchanged tests, time and coverage-bin differences. Link with `#cmp-<run id>`.
- **Waveform viewer in the run detail panel:** the run's VCD is embedded, with zoom, pan, a cursor showing every signal's value and a signal filter. Times printed in the log (`t=125 ns`, `@ 175000`) jump the cursor.
- **Rerun with waves** from the run detail panel. In VS Code it starts the run and opens its dashboard; in a browser it copies the command.
- **Ctrl+K quick search** across runs, bins, scenarios, requirements, tabs and earlier runs.
- Runs table: duration bar per run.

## 0.7.1
- **UVM on Verilator works** (no commercial license): the toolchain image now ships Verilator 5.054 from the official prebuilt image (image build ~1 min instead of ~20) and the CHIPS Alliance UVM 2020.3.2 kit for Verilator.
- Verilator UVM builds compile inside the container's own filesystem (thousands of C++ files are far too slow on a Windows-mounted folder) with a separate 30-minute build timeout.
- Generated UVM testbenches compile on Verilator: clocking-block modports and covergroups are guarded with `ifndef VERILATOR`.
- DV: Run Test → UVM lets you select several tests at once.
- Fixed: container runs returned before the tool finished (`setsid -w`); WSL no longer stops the toolchain container between runs; SymbiYosys works in the image.

## 0.7.0
- **Open-source toolchain in a container.** Icarus, Verilator (with UVM), GHDL, Yosys, SymbiYosys, cocotb/pyuvm and make can now run from a Docker image, so users only install Docker. The engine can be Docker Desktop, Docker Engine inside WSL, Podman, or Docker on Linux/macOS.
  - In the default `auto` mode, local tools are used when installed and the container otherwise. Every tool call goes through it: DV run/regression/doctor, UVM on Verilator, lint, schematics and formal.
  - New commands: *Set Up Open-Source Toolchain* (build or pull the image), *Status*, *Open Terminal in Container*, *Switch Mode*, *Stop Containers*. A status bar item shows the toolchain state, and the CLI gets `dvflow toolchain status|build|stop` plus `--toolchain`.
  - The extension offers to set it up once when no open-source simulator is installed.
- **DV: Run Test** asks for the testbench (simple or UVM) and the simulator: Icarus/Questa/VCS/Verilator for simple testbenches, Questa/VCS/Verilator for UVM. New `dvflow uvm` command.
- **Questa coverage:** per-run UCDBs are merged with `vcover` into summary, details and HTML reports. Code coverage is reported for the DUT's design units only, and covergroup coverage for UVM runs. Run Test and Run Regression ask whether to collect code coverage.
- **DV dashboard redesigned:** verdict header, KPI rings, a test × seed grid, a run detail panel with the embedded log (error highlighting, search, errors only), coverage heatmap, traceability tree, failure triage, light/dark/auto theme and keyboard shortcuts.
- **UVM: Show Architecture Diagram** (UVM Verification Hierarchy view): components, TLM ports and connections, the sequences started per test, the virtual interface hand-off, a phase map and config_db cross-reference. Generated from the sources, with SVG export.

## 0.6.3
- Lint with Icarus skips files it cannot parse (UVM, classes, concurrent SVA, clocking blocks, covergroups) instead of reporting false errors, and says why when run from the command.
- Lint ignores "Unknown module type" from Icarus: a module defined in another file is not a defect of the file being linted.
- Waveform search accepts full paths without the bit range, e.g. `dut.state == 4`.

## 0.6.2
- FSM extraction understands casts around the next-state value, e.g. `next_state = state_t'(din ? S_1 : S_IDLE);`. Before, such FSMs showed no transitions.
- Lint finds Icarus Verilog in `C:\iverilog\bin` (or `/usr/local/bin`, `/opt/homebrew/bin`) when it is not on PATH.
- DV flow: `dvflow.cmd` generated by the CLI on the editor's runtime now points at that runtime instead of a missing `node`.

## 0.6.1
- Renamed to **10xEngineers EDA**. The extension ID is now `10xengineers.10xengineer-eda`, and the MCP server is named `10xengineer-eda`. Settings (`tenxDebug.*`) and command IDs are unchanged.
- Waveforms: a `<dump>.tenxview.json` file next to a dump sets the starting view (rows, decoders, markers, cursor, tools tab).

## 0.6.0
- Waveform viewer:
  - **named multi-markers** (Markers tab, Δ to cursor and to the previous marker, rename, `N` to jump)
  - per-signal color, stroke and fill, and renderers bus / analog step / linear
  - radix unsigned, UTF-8 and float
  - WaveTrace-compatible settings `tenxDebug.wave.*`: display, keyboard, mouse and palette
- **Tools panel**:
  - 9 protocol decoders (UART, SPI, I²C, APB, AHB-Lite, AXI4-Lite, AXI-Stream, Wishbone, valid/ready) with decoded rows and a transaction table
  - multi-signal pattern search
  - switching activity
  - X-trace
  - log correlation for cocotb, UVM, Questa and `$display` lines
- GTKWave `.gtkw` import. `.fst` / `.lxt` / `.lxt2` / `.ghw` open through configurable converters.
- Waveform diff, opened side by side at the first divergence.
- Signal values at the cursor are shown inline in Verilog, SystemVerilog and VHDL.
- WaveDrom: own renderer, and SVA generation from nodes and edges (exact cycle delays or labelled windows), exported as a `.sv` checker.
- Yosys JSON schematic: click through to the source, "What drives this?" / "What does it drive?" cones, and synthesize with yosys.
- Lint waivers: `.tenx-waivers.json` plus inline `tenx-lint-waive`, with quick fixes.

## 0.1.0
- Initial release.
- VCD waveform viewer: signal browser, zoom/pan, cursor/marker, radix, live reload.
- FSM extraction from Verilog/SystemVerilog, live diagrams, SVG/Mermaid/DOT export, FSM lint checks.
- FSM state decoding and FSM coverage in the waveform viewer.
- Verilog / SystemVerilog / UVM syntax highlighting, outline, go-to-definition, snippets, UVM generator.
- Verilator / Icarus Verilog lint integration.
- Coverage dashboard: code + functional coverage from UCDB / vcover / LCOV / Verilator. Hit, hole, code and assertion sheets, analysis with constraint suggestions, Excel/CSV export, editor highlighting, trend.
- UVM environment generator driven by DUT port parsing: active/passive config, coverage, scoreboard, SVA, source list, Questa scripts.
- Questa integration: auto-detects the install on Windows and Linux, runs simulations, merges UCDBs.

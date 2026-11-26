# UVM

**UVM: Show Architecture Diagram**, also in the *UVM Verification Hierarchy* view, draws:

- the test → env → agent → sequencer, driver and monitor → scoreboard, with their TLM ports and connections
- the sequences each test starts, and the virtual interface handed down from the HDL top
- a **phase map** showing which class implements build, connect, run and report
- the **config_db** set/get pairs

To run it: **DV: Run Test** → **UVM testbench** → **Verilator** ("no license needed"), tick the tests, then pick a seed. Questa and VCS work with the same steps when installed.

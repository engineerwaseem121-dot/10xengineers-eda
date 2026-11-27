# 10xEngineers EDA design library

A library of original, synthesizable SystemVerilog designs. Each one comes with a short spec. The library is used for three things:

- **Learning and demos:** open any design → **DV: Select DUT** → **Run Regression**.
- **Identification tests:** the extension must recognise each design from its RTL (`expected_template` in `meta.json`).
- **Spec → RTL:** each `SPEC.md` is precise enough to write the RTL from it, and the RTL follows the spec exactly.

All designs are written for this library. None are copied from other projects. Protocol blocks (APB, AHB-Lite, AXI4-Lite, AXI-Stream, Wishbone, SPI, I²C, UART) follow the public behaviour of those protocols, described in our own words.

## Folder layout

```
examples/library/<category>/<name>/
  <name>.sv          RTL. Top module name = <name>. SystemVerilog-2012, synthesizable, compiles with Icarus 12 -g2012
  SPEC.md            the specification (template below)
  meta.json          identification ground truth + test hints
  <name>_check.sv    a small self-checking testbench used once to prove the RTL meets SPEC.md (prints CHECK PASS)
```

Categories: `gates`, `arithmetic`, `mux_demux`, `encode_decode`, `sequential`, `counters`, `memory`, `fifo`, `fsm`, `datapath`, `protocols`, `coding` (parity/CRC/Hamming/Gray/BCD).

## RTL rules

- One top module per file, named exactly like the folder. Helper modules can follow in the same file.
- `logic` everywhere, `always_ff` / `always_comb`, no latches unless the design is a latch, no `initial` in RTL (memories may be cleared on reset instead).
- Clock is named `clk` (or `clock`/`pclk`/`hclk`/`aclk` when the protocol uses that name). Reset is active-low async `rst_n` unless the spec says otherwise; protocol blocks use the protocol's own reset name (`presetn`, `hresetn`, `aresetn`).
- Use real-world port names as people write them (`a`, `b`, `sel`, `y`, `din`, `dout`, `wr_en`, `rd_en`, `full`, `empty`, `paddr`, `psel`…). Do not add ports that only help a testbench.
- Parameters have sensible defaults (e.g. `WIDTH = 8`).
- No vendor primitives, no `$display` in RTL.

## SPEC.md template

```markdown
# <name>: one-line title
## Function
What it does, in 2–4 sentences.
## Parameters
| Name | Default | Meaning |
## Ports
| Port | Dir | Width | Description |
## Behaviour
Exact rules: equations for combinational outputs; for sequential designs what happens on each clock edge,
on reset (values), priority between inputs, latency in cycles, what happens on overflow/underflow/illegal input.
## Example
A short table or sequence of inputs and the expected outputs.
```

## meta.json

```json
{
  "name": "fifo_sync",
  "category": "fifo",
  "expected_template": "fifo",
  "protocol": null,
  "sequential": true,
  "clock": "clk",
  "reset": "rst_n",
  "reset_active_low": true,
  "summary": "8x8 synchronous FIFO with full/empty/count",
  "check": "PASS"
}
```

`expected_template` is the template the extension should propose, one of:

| Id | Use for |
|---|---|
| `gate` | Logic gates: AND/OR/NAND/NOR/XOR/XNOR/NOT/BUF, multi-input or vector-wide |
| `adder` | Half/full/ripple/carry-lookahead adders |
| `subtractor` | Subtractors, with borrow |
| `add_sub` | Adder-subtractor with a mode input |
| `multiplier` | Combinational multipliers |
| `comparator` | Comparators: `eq`/`lt`/`gt` outputs |
| `alu` | ALUs: opcode selects an operation |
| `mux` | Multiplexers, N:1 |
| `demux` | Demultiplexers |
| `encoder` | Binary encoders, one-hot → binary |
| `priority_encoder` | Priority encoders |
| `decoder` | Binary → one-hot decoders, 7-segment |
| `code_converter` | Gray↔binary, BCD |
| `parity` | Parity generators/checkers |
| `crc` | CRC |
| `hamming` | Hamming encode/decode |
| `dff` | Flip-flops / registers |
| `latch` | Latches |
| `shift_register` | Shift registers |
| `counter` | Up counters, mod-N |
| `updown_counter` | Up/down counters |
| `lfsr` | LFSRs |
| `pc` | Program counters |
| `register_file` | Register files |
| `memory` | RAM / ROM |
| `fifo` | FIFOs |
| `pipeline` | valid/data pipelines, skid buffers |
| `fsm` | State machines |
| `custom` | Anything else |

`protocol` is one of `apb`, `ahb`, `axi4lite`, `axis`, `wishbone`, `spi`, `i2c`, `uart`, or `null`.

## Self-check (how each design was proven)

```bash
MSYS_NO_PATHCONV=1 wsl -- docker run --rm -v /mnt/c/Users/Waseem-10xE/10x-debug/examples/library:/w -w /w/<category>/<name> \
  ghcr.io/engineerwaseem121-dot/eda-tools:1.0.0 sh -c 'iverilog -g2012 -o /tmp/t.vvp <name>.sv <name>_check.sv && vvp -n /tmp/t.vvp'
```

The check testbench drives directed and random inputs, compares against an independent model written from SPEC.md, and ends with `CHECK PASS` or `CHECK FAIL`.

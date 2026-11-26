#!/bin/sh
# 10xEngineers EDA image smoke test (installed as /usr/local/bin/tenx-smoke).
# The extension runs it before switching to a downloaded update; CI runs it after every image build.
# Exit 0 = every tool the extension needs works. Prints one line per check.
set -u
T=$(mktemp -d /tmp/tenx-smoke.XXXXXX)
cd "$T" || exit 2
fail=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; fail=1; }
chk() { name=$1; shift; if "$@" >"$T/out.txt" 2>&1; then ok "$name"; else bad "$name: $(tail -3 "$T/out.txt" | tr '\n' ' ')"; fi; }

cat > counter.sv <<'EOF'
module counter (input logic clk, input logic rst_n, output logic [3:0] q);
  always_ff @(posedge clk or negedge rst_n) if (!rst_n) q <= '0; else q <= q + 1'b1;
endmodule
EOF
cat > tb.sv <<'EOF'
module tb;
  logic clk = 0, rst_n = 0; logic [3:0] q;
  counter dut (.*);
  always #5 clk = ~clk;
  initial begin #12 rst_n = 1; repeat (5) @(posedge clk); #1;
    if (q == 4'd5) $display("SMOKE_OK"); else $display("SMOKE_BAD q=%0d", q);
    $finish; end
endmodule
EOF

chk "icarus: compile + run"        sh -c 'iverilog -g2012 -o sim.vvp tb.sv counter.sv && vvp -n sim.vvp | grep -q SMOKE_OK'
chk "verilator: build + run"       sh -c 'verilator --binary --timing -Wno-fatal -Mdir vobj --top-module tb tb.sv counter.sv >/dev/null && ./vobj/Vtb | grep -q SMOKE_OK'
chk "uvm: sources present"         test -f "${UVM_HOME:-/opt/uvm}/src/uvm_pkg.sv"
chk "yosys: synthesis"             sh -c 'yosys -q -p "read_verilog -sv counter.sv; synth -top counter; stat" >/dev/null'
chk "symbiyosys: available"        sh -c 'sby --help >/dev/null'
chk "ghdl: available"              sh -c 'ghdl --version >/dev/null'
chk "cocotb: python import"        sh -c 'python -c "import cocotb, pyuvm" && cocotb-config --libpython >/dev/null'
chk "make: available"              sh -c 'make --version >/dev/null'
chk "version record"               test -s /etc/tenx-eda-tools.json

rm -rf "$T"
if [ $fail -eq 0 ]; then echo "SMOKE PASS"; else echo "SMOKE FAIL"; fi
exit $fail

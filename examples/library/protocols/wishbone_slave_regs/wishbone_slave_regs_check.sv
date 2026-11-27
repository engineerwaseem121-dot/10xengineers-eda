`timescale 1ns/1ps
module wishbone_slave_regs_check;
  logic        clk_i = 0, rst_i = 1;
  logic        cyc_i = 0, stb_i = 0, we_i = 0;
  logic [1:0]  adr_i = 0;
  logic [31:0] dat_i = 0, dat_o;
  logic [3:0]  sel_i = 0;
  logic        ack_o;
  int errors = 0, nb2b = 0;
  integer seed = 32'hB4;

  wishbone_slave_regs dut (.clk_i(clk_i), .rst_i(rst_i), .cyc_i(cyc_i), .stb_i(stb_i), .we_i(we_i),
    .adr_i(adr_i), .dat_i(dat_i), .sel_i(sel_i), .dat_o(dat_o), .ack_o(ack_o));
  always #5 clk_i = ~clk_i;
  initial begin #3000000; $display("CHECK FAIL timeout"); $finish; end

  logic [31:0] model [4];

  // classic-cycle BFM: drive on negedge, transfer ends on the rising edge where ack_o is high
  task automatic wb_xfer(input bit w, input logic [1:0] a, input logic [31:0] d, input logic [3:0] s,
                         output logic [31:0] rd);
    int t;
    @(negedge clk_i);
    if (cyc_i && stb_i) nb2b++;
    cyc_i = 1; stb_i = 1; we_i = w; adr_i = a; dat_i = d; sel_i = s;
    t = 0;
    do begin @(negedge clk_i); t++; end while (!ack_o && t < 10);
    if (t != 1) begin errors++; $display("ack latency %0d", t); end
    rd = dat_o;
    @(posedge clk_i);   // terminating edge (stb & ack)
  endtask

  task automatic idle(input int n);
    @(negedge clk_i);
    stb_i = 0; we_i = $random(seed); dat_i = $random(seed);
    if ($random(seed) & 1) cyc_i = 0;
    repeat (n) begin
      @(negedge clk_i);
      if (ack_o) begin errors++; $display("ack without strobe"); end
    end
  endtask

  task automatic do_write(input logic [1:0] a, input logic [31:0] d, input logic [3:0] s);
    logic [31:0] rd;
    wb_xfer(1, a, d, s, rd);
    for (int b = 0; b < 4; b++) if (s[b]) model[a][8*b +: 8] = d[8*b +: 8];
  endtask

  task automatic do_read(input logic [1:0] a);
    logic [31:0] rd;
    wb_xfer(0, a, $random(seed), $random(seed), rd);
    if (rd !== model[a]) begin
      errors++; if (errors < 10) $display("read %0d got %h exp %h", a, rd, model[a]);
    end
  endtask

  initial begin
    foreach (model[i]) model[i] = 0;
    repeat (2) @(posedge clk_i);
    @(negedge clk_i) rst_i = 0;
    if (ack_o !== 0) errors++;
    for (int i = 0; i < 4; i++) do_read(i);
    idle(1);
    do_write(0, 32'h01234567, 4'hF); idle(0);
    do_write(1, 32'h89ABCDEF, 4'hF); idle(2);
    do_write(2, 32'hFFFFFFFF, 4'b0011);
    do_write(3, 32'hA5A5A5A5, 4'b1001);   // back-to-back (stb stays high)
    for (int i = 0; i < 4; i++) do_read(i);
    idle(1);
    // strobe without cycle is ignored
    @(negedge clk_i) begin cyc_i = 0; stb_i = 1; we_i = 1; adr_i = 0; dat_i = 0; sel_i = 4'hF; end
    repeat (3) @(negedge clk_i) if (ack_o) begin errors++; $display("ack without cyc"); end
    stb_i = 0;
    do_read(0);
    for (int i = 0; i < 3000; i++) begin
      if ($random(seed) & 1) do_write($random(seed), $random(seed), $random(seed));
      else do_read($random(seed));
      if (($random(seed) & 3) == 0) idle($random(seed) & 3);
    end
    idle(1);
    // synchronous reset clears registers
    @(negedge clk_i) rst_i = 1; @(negedge clk_i) rst_i = 0;
    foreach (model[i]) model[i] = 0;
    for (int i = 0; i < 4; i++) do_read(i);
    if (errors == 0 && nb2b > 500) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d back_to_back=%0d", errors, nb2b);
    $finish;
  end
endmodule

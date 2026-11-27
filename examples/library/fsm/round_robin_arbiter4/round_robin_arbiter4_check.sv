`timescale 1ns/1ps
module round_robin_arbiter4_check;
  logic clk = 0, rst_n = 0;
  logic [3:0] req = 0, grant;
  int errors = 0;
  integer seed = 32'd44;
  int cnt [4];
  // independent model: pointer to last served requester
  int mlast;
  logic [3:0] mgrant;

  round_robin_arbiter4 dut (.clk(clk), .rst_n(rst_n), .req(req), .grant(grant));
  always #5 clk = ~clk;
  initial begin #1000000; $display("CHECK FAIL timeout"); $finish; end

  task automatic step(input logic [3:0] r);
    int i, w;
    @(negedge clk) req = r;
    @(posedge clk);
    w = -1;
    for (i = 1; i <= 4; i++) if (w < 0 && r[(mlast + i) % 4]) w = (mlast + i) % 4;
    if (w < 0) mgrant = 0; else begin mgrant = 4'b1 << w; mlast = w; end
    #1;
    for (i = 0; i < 4; i++) if (grant[i]) cnt[i]++;
    if (grant !== mgrant) begin
      errors++;
      if (errors < 10) $display("mismatch req=%b grant=%b exp=%b", r, grant, mgrant);
    end
  endtask

  initial begin
    mlast = 3; mgrant = 0;
    foreach (cnt[i]) cnt[i] = 0;
    #12; if (grant !== 0) errors++;
    @(negedge clk) rst_n = 1;
    // all requesting: rotate 0,1,2,3,0
    repeat (8) step(4'b1111);
    step(4'b0000);                  // idle keeps the pointer
    step(4'b1111);
    step(4'b0101); step(4'b0101); step(4'b0101);
    step(4'b1000); step(4'b1000);   // single requester keeps grant
    step(4'b0001);
    for (int i = 0; i < 4000; i++) step($random(seed));
    if (errors == 0 && cnt[0] > 100 && cnt[3] > 100) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d", errors);
    $finish;
  end
endmodule

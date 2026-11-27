`timescale 1ns/1ps
module vending_machine_check;
  logic clk = 0, rst_n = 0, coin5 = 0, coin10 = 0;
  logic vend, change;
  int errors = 0, nvend = 0, nchg = 0;
  integer seed = 32'd15;
  // independent model: credit value
  int credit;
  logic exp_vend, exp_chg;

  vending_machine dut (.clk(clk), .rst_n(rst_n), .coin5(coin5), .coin10(coin10), .vend(vend), .change(change));
  always #5 clk = ~clk;
  initial begin #1000000; $display("CHECK FAIL timeout"); $finish; end

  task automatic step(input logic c5, input logic c10);
    int add, t;
    @(negedge clk) begin coin5 = c5; coin10 = c10; end
    @(posedge clk);
    add = (c5 && !c10) ? 5 : (c10 && !c5) ? 10 : 0;
    t = credit + add;
    if (t >= 15) begin exp_vend = 1; exp_chg = (t == 20); credit = 0; end
    else begin exp_vend = 0; exp_chg = 0; credit = t; end
    #1;
    if (vend) nvend++;
    if (change) nchg++;
    if (vend !== exp_vend || change !== exp_chg) begin
      errors++;
      if (errors < 10) $display("mismatch c5=%b c10=%b vend=%b/%b change=%b/%b", c5, c10, vend, exp_vend, change, exp_chg);
    end
  endtask

  initial begin
    credit = 0; exp_vend = 0; exp_chg = 0;
    #12; if (vend !== 0 || change !== 0) errors++;
    @(negedge clk) rst_n = 1;
    // directed: 5+10 -> vend; 10+10 -> vend+change; 5+5+5 -> vend; 10+5 -> vend; both coins ignored
    step(1,0); step(0,1); step(0,0);
    step(0,1); step(0,1); step(0,0);
    step(1,0); step(1,0); step(1,0); step(0,0);
    step(0,1); step(1,0); step(0,0);
    step(1,1); step(1,0); step(1,1); step(0,1); step(0,0);
    step(0,1); step(0,0); step(0,0); step(1,0); step(0,0);   // idle cycles keep credit
    // vend cycle accepts a new coin
    step(0,1); step(0,1); step(1,0); step(0,1); step(0,0);
    for (int i = 0; i < 5000; i++) begin
      int r; r = $random(seed) & 7;
      step(r == 1 || r == 2 || r == 7, r == 3 || r == 4 || r == 7);
    end
    if (errors == 0 && nvend > 100 && nchg > 20) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d vends=%0d changes=%0d", errors, nvend, nchg);
    $finish;
  end
endmodule

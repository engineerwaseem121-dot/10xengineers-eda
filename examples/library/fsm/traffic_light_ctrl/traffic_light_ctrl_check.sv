`timescale 1ns/1ps
module traffic_light_ctrl_check;
  localparam int G = 5, Y = 3;
  logic clk = 0, rst_n = 0;
  logic ns_r, ns_y, ns_g, ew_r, ew_y, ew_g;
  int errors = 0;

  traffic_light_ctrl #(.GREEN_TIME(G), .YELLOW_TIME(Y)) dut (
    .clk(clk), .rst_n(rst_n), .ns_red(ns_r), .ns_yellow(ns_y), .ns_green(ns_g),
    .ew_red(ew_r), .ew_yellow(ew_y), .ew_green(ew_g));

  always #5 clk = ~clk;
  initial begin #200000; $display("CHECK FAIL timeout"); $finish; end

  // independent model: absolute cycle count since reset release
  int cyc;
  function automatic logic [5:0] expect_lights(int c);
    int p; p = c % (2*G + 2*Y);
    if (p < G)            return 6'b001_100; // ns green, ew red   {ns_r,ns_y,ns_g, ew_r,ew_y,ew_g}
    else if (p < G+Y)     return 6'b010_100;
    else if (p < 2*G+Y)   return 6'b100_001;
    else                  return 6'b100_010;
  endfunction

  task automatic check_now(int c);
    logic [5:0] got, exp;
    got = {ns_r, ns_y, ns_g, ew_r, ew_y, ew_g};
    exp = expect_lights(c);
    if (got !== exp) begin
      errors++;
      if (errors < 10) $display("mismatch cycle %0d got %b exp %b", c, got, exp);
    end
  endtask

  initial begin
    repeat (3) @(posedge clk);
    #1 check_now(0);
    @(negedge clk) rst_n = 1;
    cyc = 0;
    for (int i = 0; i < 200; i++) begin
      check_now(cyc);
      @(posedge clk); cyc++;
      @(negedge clk);
    end
    // asynchronous reset in the middle
    #2 rst_n = 0; #1 check_now(0);
    @(negedge clk) rst_n = 1; cyc = 0;
    for (int i = 0; i < 50; i++) begin
      check_now(cyc);
      @(posedge clk); cyc++;
      @(negedge clk);
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

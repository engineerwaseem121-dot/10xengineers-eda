`timescale 1ns/1ps
module seq_detector_1011_mealy_check;
  logic clk = 0, rst_n = 0, din = 0, detected;
  int errors = 0, hits = 0;
  logic [2:0] hist;   // last three sampled bits, newest in bit 0
  int nbits;
  integer seed = 32'd2024;
  logic [15:0] dir_bits = 16'b1011011101011100;  // sent MSB first

  seq_detector_1011_mealy dut (.clk(clk), .rst_n(rst_n), .din(din), .detected(detected));
  always #5 clk = ~clk;
  initial begin #500000; $display("CHECK FAIL timeout"); $finish; end

  task automatic step(input logic b);
    logic exp;
    @(negedge clk) din = b;
    #1;
    exp = (nbits >= 3) && ({hist, b} == 4'b1011);
    if (exp) hits++;
    if (detected !== exp) begin
      errors++;
      if (errors < 10) $display("mismatch bit#%0d hist=%b din=%b detected=%b exp=%b", nbits, hist, b, detected, exp);
    end
    @(posedge clk);
    hist = {hist[1:0], b}; nbits++;
  endtask

  initial begin
    hist = 0; nbits = 0;
    #12;
    @(negedge clk) rst_n = 1;
    for (int i = 15; i >= 0; i--) step(dir_bits[i]);
    for (int i = 0; i < 4000; i++) step($random(seed));
    if (errors == 0 && hits > 50) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d hits=%0d", errors, hits);
    $finish;
  end
endmodule

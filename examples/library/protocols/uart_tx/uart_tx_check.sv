`timescale 1ns/1ps
module uart_tx_check;
  localparam int CPB = 8;
  logic       clk = 0, rst_n = 0, tx_start = 0;
  logic [7:0] tx_data = 0;
  logic       tx, tx_busy, tx_done;
  int errors = 0, nbytes = 0;
  integer seed = 32'h0A27;

  uart_tx #(.CLKS_PER_BIT(CPB)) dut (.clk(clk), .rst_n(rst_n), .tx_start(tx_start), .tx_data(tx_data),
    .tx(tx), .tx_busy(tx_busy), .tx_done(tx_done));
  always #5 clk = ~clk;
  initial begin #5000000; $display("CHECK FAIL timeout"); $finish; end

  // independent line checker: every one of the 10 bit cells must hold its value for exactly CPB cycles
  task automatic send_and_check(input logic [7:0] d, input bit back_to_back);
    logic [9:0] frame;
    frame = {1'b1, d, 1'b0};    // stop, data (LSB first), start
    if (!back_to_back) @(negedge clk);
    tx_start = 1; tx_data = d;
    @(negedge clk); tx_start = 0; tx_data = $random(seed);
    // first cycle of the start bit is the cycle after the accepting edge
    for (int b = 0; b < 10; b++) begin
      for (int c = 0; c < CPB; c++) begin
        if (tx !== frame[b] || tx_busy !== 1 || tx_done !== 0) begin
          errors++;
          if (errors < 10) $display("byte %h bit %0d cycle %0d: tx=%b exp %b busy=%b", d, b, c, tx, frame[b], tx_busy);
        end
        if (b == 3 && c == 2) begin tx_start = 1; tx_data = ~d; end   // ignored while busy
        if (b == 3 && c == 3) tx_start = 0;
        @(negedge clk);
      end
    end
    if (tx_done !== 1 || tx_busy !== 0 || tx !== 1) begin errors++; $display("no tx_done after byte %h", d); end
    nbytes++;
  endtask

  initial begin
    #22;
    if (tx !== 1 || tx_busy !== 0 || tx_done !== 0) errors++;
    rst_n = 1;
    send_and_check(8'h55, 0);
    send_and_check(8'h00, 0);
    send_and_check(8'hFF, 1);     // start given in the tx_done cycle
    send_and_check(8'hA3, 1);
    repeat (5) @(negedge clk);
    if (tx !== 1 || tx_busy !== 0) errors++;
    for (int i = 0; i < 300; i++) begin
      bit b2b; b2b = $random(seed);
      if (!b2b) repeat ($random(seed) & 7) @(negedge clk);
      send_and_check($random(seed), b2b);
    end
    if (errors == 0 && nbytes == 304) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d bytes=%0d", errors, nbytes);
    $finish;
  end
endmodule

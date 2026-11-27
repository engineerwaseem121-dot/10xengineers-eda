`timescale 1ns/1ps
module spi_slave_check;
  logic       clk = 0, rst_n = 0;
  logic       sclk = 0, cs_n = 1, mosi = 0, miso;
  logic [7:0] tx_data = 0, rx_data;
  logic       rx_valid;
  int errors = 0, nbytes = 0;
  integer seed = 32'h5A5;

  spi_slave dut (.clk(clk), .rst_n(rst_n), .sclk(sclk), .cs_n(cs_n), .mosi(mosi), .miso(miso),
    .tx_data(tx_data), .rx_data(rx_data), .rx_valid(rx_valid));
  always #5 clk = ~clk;
  initial begin #10000000; $display("CHECK FAIL timeout"); $finish; end

  // expected bytes at the slave, checked on every rx_valid pulse
  logic [7:0] exp_q [$];
  always @(posedge clk) begin
    if (rst_n && rx_valid) begin
      if (exp_q.size() == 0) begin errors++; $display("unexpected rx_valid"); end
      else begin : chk
        logic [7:0] e; e = exp_q.pop_front();
        if (rx_data !== e) begin errors++; if (errors < 10) $display("slave rx %h exp %h", rx_data, e); end
        nbytes++;
      end
    end
  end

  // mode-0 master BFM: half period in ns (asynchronous to clk), frame of n bytes
  task automatic frame(input int n, input real half_ns);
    logic [7:0] m, s, got;
    s = $random(seed);
    tx_data = s;
    #(half_ns);
    cs_n = 0;
    for (int k = 0; k < n; k++) begin
      m = $random(seed);
      got = 0;
      for (int b = 7; b >= 0; b--) begin
        mosi = m[b];
        #(half_ns);
        sclk = 1; got = {got[6:0], miso};
        if (b == 0) begin
          exp_q.push_back(m);
          // provide the next byte to send before the final falling edge of this byte
          #(half_ns * 0.5);
          tx_data = $random(seed);
          #(half_ns * 0.5);
        end else #(half_ns);
        sclk = 0;
      end
      if (got !== s) begin errors++; if (errors < 10) $display("master got %h exp %h", got, s); end
      s = tx_data;
    end
    #(half_ns);
    cs_n = 1; mosi = $random(seed);
    #(half_ns * 2);
  endtask

  initial begin
    #22 rst_n = 1;
    #100;
    frame(1, 80.0);
    frame(3, 60.0);
    frame(2, 43.0);     // just over 4 clk cycles per half period
    for (int i = 0; i < 150; i++) frame(1 + ($random(seed) & 3), 45.0 + (($random(seed) & 255) % 60));
    #1000;
    if (errors == 0 && exp_q.size() == 0 && nbytes > 300) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d pending=%0d bytes=%0d", errors, exp_q.size(), nbytes);
    $finish;
  end
endmodule

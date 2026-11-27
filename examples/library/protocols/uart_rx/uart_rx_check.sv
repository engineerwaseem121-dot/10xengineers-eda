`timescale 1ns/1ps
module uart_rx_check;
  localparam int CPB = 16;
  logic       clk = 0, rst_n = 0, rx = 1;
  logic [7:0] rx_data;
  logic       rx_valid, framing_error;
  int errors = 0, ngood = 0, nferr = 0;
  integer seed = 32'h0B0D;

  uart_rx #(.CLKS_PER_BIT(CPB)) dut (.clk(clk), .rst_n(rst_n), .rx(rx), .rx_data(rx_data),
    .rx_valid(rx_valid), .framing_error(framing_error));
  always #5 clk = ~clk;
  initial begin #20000000; $display("CHECK FAIL timeout"); $finish; end

  // expected events, pushed by the line driver, popped by the monitor
  logic [8:0] exp_q [$];   // {is_framing_error, data}

  // line driver: bit period CPB clocks, optional phase offset (asynchronous to clk)
  task automatic send_frame(input logic [7:0] d, input bit stop_bit, input int phase_ps);
    #(phase_ps / 1000.0);
    rx = 0; repeat (CPB) @(posedge clk);
    for (int i = 0; i < 8; i++) begin rx = d[i]; repeat (CPB) @(posedge clk); end
    exp_q.push_back({!stop_bit, d});
    rx = stop_bit; repeat (CPB) @(posedge clk);
    rx = 1;
  endtask

  always @(posedge clk) begin
    if (rst_n && (rx_valid || framing_error)) begin
      if (rx_valid && framing_error) begin errors++; $display("both flags"); end
      if (exp_q.size() == 0) begin errors++; $display("unexpected byte %h", rx_data); end
      else begin : chk
        logic [8:0] e; e = exp_q.pop_front();
        if (framing_error !== e[8] || rx_data !== e[7:0]) begin
          errors++; if (errors < 10) $display("got %h ferr=%b exp %h ferr=%b", rx_data, framing_error, e[7:0], e[8]);
        end
        if (e[8]) nferr++; else ngood++;
      end
    end
  end

  initial begin
    #22 rst_n = 1;
    repeat (5) @(posedge clk);
    send_frame(8'h55, 1, 0); repeat (2) @(posedge clk);
    send_frame(8'h00, 1, 0);
    send_frame(8'hFF, 1, 0);                         // back-to-back frames
    send_frame(8'hA5, 0, 0);                         // framing error
    repeat (3 * CPB) @(posedge clk);                 // line held low after the bad stop bit
    rx = 1; repeat (2 * CPB) @(posedge clk);
    // glitch shorter than half a bit must be ignored
    rx = 0; repeat (CPB / 4) @(posedge clk); rx = 1;
    repeat (2 * CPB) @(posedge clk);
    send_frame(8'h3C, 1, 0);
    for (int i = 0; i < 400; i++) begin
      bit sb; sb = ($random(seed) & 15) != 0;
      send_frame($random(seed), sb, ($random(seed) & 32'h1FFF) % 10000);
      if (!sb) begin repeat (CPB) @(posedge clk); end
      repeat ($random(seed) & 3) @(posedge clk);
    end
    repeat (4 * CPB) @(posedge clk);
    if (errors == 0 && exp_q.size() == 0 && nferr > 10 && ngood > 300) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d pending=%0d good=%0d ferr=%0d", errors, exp_q.size(), ngood, nferr);
    $finish;
  end
endmodule

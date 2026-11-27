`timescale 1ns/1ps
module valid_ready_pipeline_check;
  logic       clk = 0, rst_n = 0;
  logic       in_valid = 0, in_ready, out_valid, out_ready = 0;
  logic [7:0] in_data = 0, out_data;
  int errors = 0, nsent = 0, nrecv = 0, nboth = 0;
  integer seed = 32'h2B;
  int p_valid, p_ready;

  valid_ready_pipeline #(.DATA_W(8)) dut (.clk(clk), .rst_n(rst_n), .in_valid(in_valid), .in_ready(in_ready),
    .in_data(in_data), .out_valid(out_valid), .out_ready(out_ready), .out_data(out_data));
  always #5 clk = ~clk;
  initial begin #3000000; $display("CHECK FAIL timeout"); $finish; end

  logic [7:0] q [$];
  logic       in_hs;
  int         first_out;   // cycle of first output after reset with constant streaming
  int         cyc, first_in;

  always @(posedge clk) begin
    if (rst_n) begin
      cyc++;
      in_hs = in_valid && in_ready;
      if (out_valid && out_ready) begin
        if (q.size() == 0) begin errors++; $display("output without input"); end
        else begin : pop
          logic [7:0] e; e = q.pop_front();
          if (out_data !== e) begin errors++; if (errors < 10) $display("got %h exp %h", out_data, e); end
        end
        nrecv++;
        if (first_out < 0) first_out = cyc;
      end
      if (in_hs) begin q.push_back(in_data); nsent++; if (first_in < 0) first_in = cyc; end
      if (in_hs && out_valid && out_ready) nboth++;
      // at most two beats can be inside the pipeline
      if (q.size() > 2) begin errors++; $display("more than 2 beats buffered"); end
    end
  end

  always @(negedge clk) begin
    if (rst_n) begin
      if (!in_valid || in_hs) begin
        in_valid = ($random(seed) % 1000 + 1000) % 1000 < p_valid;
        in_data = $random(seed);
      end
      out_ready = ($random(seed) % 1000 + 1000) % 1000 < p_ready;
    end
  end

  initial begin
    in_hs = 0; cyc = 0; first_out = -1; first_in = -1;
    p_valid = 1000; p_ready = 1000;
    #22 rst_n = 1;
    if (out_valid !== 0 || in_ready !== 1) errors++;
    repeat (100) @(posedge clk);
    // latency: first beat accepted at edge 1 appears at the output after two edges
    if (first_out - first_in != 2) begin errors++; $display("latency %0d", first_out - first_in); end
    if (nboth < 95) begin errors++; $display("not full throughput: %0d", nboth); end
    p_valid = 1000; p_ready = 0;
    repeat (10) @(posedge clk);           // stall: pipeline fills with 2 beats
    if (in_ready !== 0) begin errors++; $display("in_ready should be low when full"); end
    for (int ph = 0; ph < 20; ph++) begin
      p_valid = ($random(seed) & 1023) % 1000; p_ready = ($random(seed) & 1023) % 1000;
      repeat (300) @(posedge clk);
    end
    p_valid = 0; p_ready = 1000;
    repeat (10) @(posedge clk);
    if (errors == 0 && q.size() == 0 && nsent == nrecv) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d sent=%0d recv=%0d", errors, nsent, nrecv);
    $finish;
  end
endmodule

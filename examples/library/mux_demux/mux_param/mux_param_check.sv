module mux_param_check;
  // default configuration and a non-power-of-two configuration
  localparam int N1 = 4, W1 = 8, S1 = 2;
  localparam int N2 = 5, W2 = 4, S2 = 3;
  logic [N1*W1-1:0] in1;  logic [S1-1:0] sel1;  logic [W1-1:0] y1, e1;
  logic [N2*W2-1:0] in2;  logic [S2-1:0] sel2;  logic [W2-1:0] y2, e2;
  int seed = 32'h0A0A;
  int errors = 0;
  mux_param                         dut1 (.in_data(in1), .sel(sel1), .y(y1));
  mux_param #(.N(N2), .WIDTH(W2))   dut2 (.in_data(in2), .sel(sel2), .y(y2));
  initial begin
    // 34 / 23 input bits: 500 random vectors each, fixed seed
    for (int i = 0; i < 500; i++) begin
      in1 = $random(seed); sel1 = $random(seed);
      in2 = {$random(seed), $random(seed)}; sel2 = $random(seed);
      #1;
      e1 = (in1 >> (int'(sel1) * W1));
      e2 = (int'(sel2) < N2) ? (in2 >> (int'(sel2) * W2)) : '0;
      if (y1 !== e1) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL N=4 in=%h sel=%0d y=%h expected=%h", in1, sel1, y1, e1);
      end
      if (y2 !== e2) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL N=5 in=%h sel=%0d y=%h expected=%h", in2, sel2, y2, e2);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

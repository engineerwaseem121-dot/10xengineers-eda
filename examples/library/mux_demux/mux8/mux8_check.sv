module mux8_check;
  localparam int WIDTH = 8;
  logic [8*WIDTH-1:0] in_data;
  logic [2:0] sel;
  logic [WIDTH-1:0] y, e;
  int seed = 32'h0808;
  int errors = 0;
  mux8 #(.WIDTH(WIDTH)) dut (.in_data(in_data), .sel(sel), .y(y));
  initial begin
    // 67 input bits: 500 random vectors, fixed seed
    for (int i = 0; i < 500; i++) begin
      in_data = {$random(seed), $random(seed)};
      sel = $random(seed);
      #1;
      // model: shift the chosen slice down to bit 0
      e = (in_data >> (int'(sel) * WIDTH));
      if (y !== e) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL in_data=%h sel=%0d y=%h expected=%h", in_data, sel, y, e);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

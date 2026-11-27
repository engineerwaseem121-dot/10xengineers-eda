module mux4_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] d0, d1, d2, d3, y, e;
  logic [1:0] sel;
  int seed = 32'h0404;
  int errors = 0;
  mux4 #(.WIDTH(WIDTH)) dut (.d0(d0), .d1(d1), .d2(d2), .d3(d3), .sel(sel), .y(y));
  initial begin
    // 34 input bits: 500 random vectors, fixed seed
    for (int i = 0; i < 500; i++) begin
      d0 = $random(seed); d1 = $random(seed); d2 = $random(seed); d3 = $random(seed);
      sel = $random(seed);
      #1;
      if (sel == 2'd0) e = d0;
      else if (sel == 2'd1) e = d1;
      else if (sel == 2'd2) e = d2;
      else e = d3;
      if (y !== e) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL sel=%0d d=%h %h %h %h y=%h expected=%h", sel, d0, d1, d2, d3, y, e);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

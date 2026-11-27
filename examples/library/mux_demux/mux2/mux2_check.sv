module mux2_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] a, b, y, e;
  logic sel;
  int seed = 32'h0202;
  int errors = 0;
  mux2 #(.WIDTH(WIDTH)) dut (.a(a), .b(b), .sel(sel), .y(y));
  initial begin
    // 17 input bits: 500 random vectors, fixed seed
    for (int i = 0; i < 500; i++) begin
      a = $random(seed); b = $random(seed); sel = $random(seed);
      #1;
      if (sel == 1'b0) e = a; else e = b;
      if (y !== e) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL a=%h b=%h sel=%b y=%h expected=%h", a, b, sel, y, e);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

module multiplier8_signed_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] a, b;          // driven as raw bits
  logic [2*WIDTH-1:0] product;
  int sa, sb, e, errors = 0;
  multiplier8_signed #(.WIDTH(WIDTH)) dut (.a(a), .b(b), .product(product));
  initial begin
    // 16 input bits: exhaustive
    for (int i = 0; i < (1 << (2*WIDTH)); i++) begin
      {a, b} = i[2*WIDTH-1:0];
      #1;
      sa = (int'(a) >= 128) ? int'(a) - 256 : int'(a);
      sb = (int'(b) >= 128) ? int'(b) - 256 : int'(b);
      e  = sa * sb;
      if (product !== e[2*WIDTH-1:0]) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL a=%0d b=%0d product=%h expected=%0d (%h)", sa, sb, product, e, e[15:0]);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

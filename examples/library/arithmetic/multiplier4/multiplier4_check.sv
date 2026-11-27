module multiplier4_check;
  localparam int WIDTH = 4;
  logic [WIDTH-1:0] a, b;
  logic [2*WIDTH-1:0] product;
  int e, errors = 0;
  multiplier4 #(.WIDTH(WIDTH)) dut (.a(a), .b(b), .product(product));
  initial begin
    for (int i = 0; i < (1 << (2*WIDTH)); i++) begin
      {a, b} = i[2*WIDTH-1:0];
      #1;
      e = int'(a) * int'(b);
      if (product !== e[2*WIDTH-1:0]) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL a=%0d b=%0d product=%0d expected=%0d", a, b, product, e);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

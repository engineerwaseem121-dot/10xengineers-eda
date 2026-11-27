module subtractor8_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] a, b, diff, e_diff;
  logic borrow, e_borrow;
  int d, errors = 0;
  subtractor8 #(.WIDTH(WIDTH)) dut (.a(a), .b(b), .diff(diff), .borrow(borrow));
  initial begin
    // 16 input bits: exhaustive
    for (int i = 0; i < (1 << (2*WIDTH)); i++) begin
      {a, b} = i[2*WIDTH-1:0];
      #1;
      d = int'(a) - int'(b);
      e_borrow = (d < 0);
      e_diff = (d < 0) ? (d + (1 << WIDTH)) : d;
      if (diff !== e_diff || borrow !== e_borrow) begin
        errors++;
        if (errors < 10)
          $display("CHECK FAIL a=%0d b=%0d diff=%0d borrow=%b expected diff=%0d borrow=%b", a, b, diff, borrow, e_diff, e_borrow);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

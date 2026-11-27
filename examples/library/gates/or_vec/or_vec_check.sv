module or_vec_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] a, b, y, exp_y;
  int errors = 0;
  or_vec #(.WIDTH(WIDTH)) dut (.a(a), .b(b), .y(y));
  initial begin
    // 16 input bits: exhaustive
    for (int i = 0; i < (1 << (2*WIDTH)); i++) begin
      {a, b} = i[2*WIDTH-1:0];
      #1;
      for (int k = 0; k < WIDTH; k++)
        exp_y[k] = (a[k] == 1'b1 || b[k] == 1'b1) ? 1'b1 : 1'b0;
      if (y !== exp_y) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL a=%h b=%h y=%h expected=%h", a, b, y, exp_y);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

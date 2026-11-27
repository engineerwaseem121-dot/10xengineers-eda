module buf1_check;
  logic a, y, exp_y;
  int errors = 0;
  buf1 dut (.a(a), .y(y));
  initial begin
    for (int i = 0; i < 2; i++) begin
      a = i[0];
      #1;
      exp_y = (a == 1'b0) ? 1'b0 : 1'b1;   // truth table from SPEC.md
      if (y !== exp_y) begin
        errors++;
        $display("CHECK FAIL a=%b y=%b expected=%b", a, y, exp_y);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

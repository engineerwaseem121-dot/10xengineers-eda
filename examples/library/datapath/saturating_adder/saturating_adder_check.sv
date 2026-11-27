module saturating_adder_check;
  logic [7:0] a, b, sum, exp;
  logic sat, exp_sat;
  int errors = 0;
  saturating_adder dut (.a(a), .b(b), .sum(sum), .sat(sat));
  initial begin
    for (int v = 0; v < 65536; v++) begin
      int s;
      {a, b} = v[15:0];
      s = int'(a) + int'(b);
      exp_sat = (s > 255);
      exp = (s > 255) ? 8'd255 : s[7:0];
      #1;
      if (sum !== exp || sat !== exp_sat) begin
        if (errors < 10) $display("mismatch a=%0d b=%0d sum=%0d/%0d sat=%b/%b", a, b, sum, exp, sat, exp_sat);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

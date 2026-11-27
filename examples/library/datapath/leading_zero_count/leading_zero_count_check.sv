module leading_zero_count_check;
  logic [15:0] in;
  logic [4:0]  count, exp;
  int errors = 0;
  leading_zero_count dut (.in(in), .count(count));
  initial begin
    for (int v = 0; v < 65536; v++) begin
      int n;
      in = v[15:0];
      n = 0;
      // count zeros from the MSB down until the first one
      for (int i = 15; i >= 0 && in[i] == 1'b0; i--) n++;
      exp = n[4:0];
      #1;
      if (count !== exp) begin
        if (errors < 10) $display("mismatch in=%h count=%0d exp=%0d", in, count, exp);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

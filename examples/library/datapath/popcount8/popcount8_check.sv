module popcount8_check;
  logic [7:0] in;
  logic [3:0] count, exp;
  int errors = 0;
  popcount8 dut (.in(in), .count(count));
  initial begin
    for (int v = 0; v < 256; v++) begin
      int n, x;
      in = v[7:0];
      // Kernighan's method: clear the lowest set bit until zero
      n = 0; x = v;
      while (x != 0) begin x = x & (x - 1); n++; end
      exp = n[3:0];
      #1;
      if (count !== exp) begin
        if (errors < 10) $display("mismatch in=%b count=%0d exp=%0d", in, count, exp);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

module even_parity_gen_check;
  logic [7:0] data;
  logic parity, exp;
  int errors = 0;
  even_parity_gen dut (.data(data), .parity(parity));
  initial begin
    for (int v = 0; v < 256; v++) begin
      int ones;
      data = v[7:0];
      ones = 0;
      for (int i = 0; i < 8; i++) if (data[i]) ones++;
      exp = (ones % 2 == 1);   // total ones (data + parity) must be even
      #1;
      if (parity !== exp) begin
        if (errors < 10) $display("mismatch data=%h parity=%b exp=%b", data, parity, exp);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

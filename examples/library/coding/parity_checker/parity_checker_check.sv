module parity_checker_check;
  logic [7:0] data;
  logic parity_in, error, exp;
  int errors = 0;
  parity_checker dut (.data(data), .parity_in(parity_in), .error(error));
  initial begin
    for (int v = 0; v < 512; v++) begin
      int ones;
      {parity_in, data} = v[8:0];
      ones = parity_in;
      for (int i = 0; i < 8; i++) if (data[i]) ones++;
      exp = (ones % 2 != 0);
      #1;
      if (error !== exp) begin
        if (errors < 10) $display("mismatch data=%h parity_in=%b error=%b exp=%b", data, parity_in, error, exp);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

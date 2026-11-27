module gray2bin_check;
  logic [7:0] gray, bin, exp;
  logic [4:0] gray5, bin5, exp5;
  int errors = 0;
  gray2bin #(.WIDTH(8)) dut (.gray(gray), .bin(bin));
  gray2bin #(.WIDTH(5)) dut5 (.gray(gray5), .bin(bin5));
  initial begin
    for (int v = 0; v < 256; v++) begin
      gray = v[7:0];
      for (int i = 0; i < 8; i++) begin
        exp[i] = 1'b0;
        for (int j = i; j < 8; j++) exp[i] = exp[i] ^ gray[j];
      end
      #1;
      if (bin !== exp) begin
        if (errors < 10) $display("mismatch gray=%h bin=%h exp=%h", gray, bin, exp);
        errors++;
      end
    end
    // round trip: encode b with b ^ (b >> 1) and expect b back
    for (int v = 0; v < 32; v++) begin
      exp5 = v[4:0];
      gray5 = exp5 ^ (exp5 >> 1);
      #1;
      if (bin5 !== exp5) begin
        if (errors < 10) $display("W5 mismatch gray=%h bin=%h exp=%h", gray5, bin5, exp5);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

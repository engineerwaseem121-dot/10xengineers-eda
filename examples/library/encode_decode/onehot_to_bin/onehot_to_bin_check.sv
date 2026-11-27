module onehot_to_bin_check;
  // default N = 8 (exhaustive) and N = 5 (non power of two, exhaustive)
  logic [7:0] oh8;
  logic [2:0] bin8, exp8;
  logic [4:0] oh5;
  logic [2:0] bin5, exp5;
  int errors = 0;

  onehot_to_bin #(.N(8)) dut8 (.onehot(oh8), .bin(bin8));
  onehot_to_bin #(.N(5)) dut5 (.onehot(oh5), .bin(bin5));

  initial begin
    for (int v = 0; v < 256; v++) begin
      oh8 = v[7:0];
      exp8 = 0;
      for (int i = 0; i < 8; i++) if (oh8[i]) exp8 = exp8 | i[2:0];
      #1;
      if (bin8 !== exp8) begin
        if (errors < 10) $display("N=8 mismatch onehot=%b bin=%b exp=%b", oh8, bin8, exp8);
        errors++;
      end
    end
    for (int v = 0; v < 32; v++) begin
      oh5 = v[4:0];
      exp5 = 0;
      for (int i = 0; i < 5; i++) if (oh5[i]) exp5 = exp5 | i[2:0];
      #1;
      if (bin5 !== exp5) begin
        if (errors < 10) $display("N=5 mismatch onehot=%b bin=%b exp=%b", oh5, bin5, exp5);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

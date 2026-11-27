module bin2bcd8_check;
  logic [7:0]  bin;
  logic [11:0] bcd, exp;
  int errors = 0;
  bin2bcd8 dut (.bin(bin), .bcd(bcd));
  initial begin
    for (int v = 0; v < 256; v++) begin
      bin = v[7:0];
      exp[11:8] = 4'(v / 100);
      exp[7:4]  = 4'((v / 10) % 10);
      exp[3:0]  = 4'(v % 10);
      #1;
      if (bcd !== exp) begin
        if (errors < 10) $display("mismatch bin=%0d bcd=%h exp=%h", bin, bcd, exp);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

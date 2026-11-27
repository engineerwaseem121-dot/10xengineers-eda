module full_subtractor_check;
  logic a, b, bin, diff, bout;
  int d, errors = 0;
  logic e_diff, e_bout;
  full_subtractor dut (.a(a), .b(b), .bin(bin), .diff(diff), .bout(bout));
  initial begin
    for (int i = 0; i < 8; i++) begin
      {a, b, bin} = i[2:0];
      #1;
      d = int'(a) - int'(b) - int'(bin);   // -2..1
      e_bout = (d < 0);
      e_diff = ((d + 2) % 2) == 1;
      if (diff !== e_diff || bout !== e_bout) begin
        errors++;
        $display("CHECK FAIL a=%b b=%b bin=%b diff=%b bout=%b expected diff=%b bout=%b", a, b, bin, diff, bout, e_diff, e_bout);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

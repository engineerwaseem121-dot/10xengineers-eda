module half_subtractor_check;
  logic a, b, diff, borrow;
  int d, errors = 0;
  half_subtractor dut (.a(a), .b(b), .diff(diff), .borrow(borrow));
  initial begin
    for (int i = 0; i < 4; i++) begin
      {a, b} = i[1:0];
      #1;
      d = int'(a) - int'(b);   // -1, 0 or 1
      if (diff !== (d != 0) || borrow !== (d < 0)) begin
        errors++;
        $display("CHECK FAIL a=%b b=%b diff=%b borrow=%b expected a-b=%0d", a, b, diff, borrow, d);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

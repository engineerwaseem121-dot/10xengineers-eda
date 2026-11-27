module half_adder_check;
  logic a, b, sum, carry;
  int total, errors = 0;
  half_adder dut (.a(a), .b(b), .sum(sum), .carry(carry));
  initial begin
    for (int i = 0; i < 4; i++) begin
      {a, b} = i[1:0];
      #1;
      total = int'(a) + int'(b);
      if (sum !== total[0] || carry !== total[1]) begin
        errors++;
        $display("CHECK FAIL a=%b b=%b sum=%b carry=%b expected %0d", a, b, sum, carry, total);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

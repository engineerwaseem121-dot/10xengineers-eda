module full_adder_check;
  logic a, b, cin, sum, cout;
  int total, errors = 0;
  full_adder dut (.a(a), .b(b), .cin(cin), .sum(sum), .cout(cout));
  initial begin
    for (int i = 0; i < 8; i++) begin
      {a, b, cin} = i[2:0];
      #1;
      total = int'(a) + int'(b) + int'(cin);
      if (sum !== total[0] || cout !== total[1]) begin
        errors++;
        $display("CHECK FAIL a=%b b=%b cin=%b sum=%b cout=%b expected %0d", a, b, cin, sum, cout, total);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

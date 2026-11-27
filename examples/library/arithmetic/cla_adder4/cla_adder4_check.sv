module cla_adder4_check;
  logic [3:0] a, b, sum;
  logic cin, cout;
  int total, errors = 0;
  cla_adder4 dut (.a(a), .b(b), .cin(cin), .sum(sum), .cout(cout));
  initial begin
    for (int i = 0; i < 512; i++) begin
      {a, b, cin} = i[8:0];
      #1;
      total = int'(a) + int'(b) + int'(cin);
      if (sum !== total[3:0] || cout !== total[4]) begin
        errors++;
        if (errors < 10)
          $display("CHECK FAIL a=%h b=%h cin=%b sum=%h cout=%b expected %0d", a, b, cin, sum, cout, total);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

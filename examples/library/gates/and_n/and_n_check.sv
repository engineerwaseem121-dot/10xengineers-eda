module and_n_check;
  localparam int N = 4;
  logic [N-1:0] a;
  logic y, exp_y;
  int errors = 0;
  and_n #(.N(N)) dut (.a(a), .y(y));
  initial begin
    for (int i = 0; i < (1 << N); i++) begin
      a = i[N-1:0];
      #1;
      exp_y = (i == (1 << N) - 1);   // only all-ones gives 1
      if (y !== exp_y) begin
        errors++;
        $display("CHECK FAIL a=%b y=%b expected=%b", a, y, exp_y);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

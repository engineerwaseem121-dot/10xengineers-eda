module t_ff_check;
  logic clk = 0, rst_n = 1, t = 0;
  logic q, exp_q;
  int errors = 0;
  integer seed = 99;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  t_ff dut (.clk(clk), .rst_n(rst_n), .t(t), .q(q));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (q !== exp_q) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t q=%b exp=%b", what, $time, q, exp_q);
    end
  endtask
  task automatic cycle(logic r, logic nt);
    @(negedge clk); t = nt;
    if (!r) begin rst_n = 0; #1 exp_q = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk); if (rst_n) exp_q = exp_q ^ t; #1 cmp("edge");
  endtask
  initial begin
    #1 rst_n = 0; exp_q = 0; #1 cmp("reset");
    cycle(1, 1); cycle(1, 1); cycle(1, 0); cycle(1, 1); cycle(1, 0); cycle(0, 1); cycle(1, 1);
    for (int i = 0; i < 500; i++) cycle((rnd() % 40) != 0, rnd() % 2);
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

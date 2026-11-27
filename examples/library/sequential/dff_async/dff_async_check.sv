module dff_async_check;
  logic clk = 0, rst_n = 1, d = 0;
  logic q;
  logic exp_q;
  int errors = 0;
  integer seed = 1234;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  dff_async dut (.clk(clk), .rst_n(rst_n), .d(d), .q(q));
  always #5 clk = ~clk;

  task automatic cmp(string what);
    if (q !== exp_q) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t q=%b exp=%b", what, $time, q, exp_q);
    end
  endtask

  task automatic cycle(logic nd);
    @(negedge clk); d = nd;
    @(posedge clk); exp_q = rst_n ? d : 1'b0; #1 cmp("edge");
  endtask

  initial begin

    exp_q = 0;
    #1 rst_n = 0; #1 cmp("reset");
    @(negedge clk); rst_n = 1;
    cycle(1); cycle(0); cycle(1); cycle(1);
    // async reset mid cycle
    @(negedge clk); #1 rst_n = 0; #1 exp_q = 0; cmp("async reset");
    @(posedge clk); #1 cmp("held in reset");
    @(negedge clk); rst_n = 1;
    for (int i = 0; i < 500; i++) begin
      @(negedge clk);
      d = rnd() % 2;
      if ((rnd() % 50) == 0) begin rst_n = 0; #1 exp_q = 0; cmp("rnd async"); end
      else rst_n = 1;
      @(posedge clk); exp_q = rst_n ? d : 1'b0; #1 cmp("random");
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

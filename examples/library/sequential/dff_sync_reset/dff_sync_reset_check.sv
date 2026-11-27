module dff_sync_reset_check;
  logic clk = 0, rst = 1, d = 0;
  logic q, exp_q;
  int errors = 0;
  integer seed = 4321;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  dff_sync_reset dut (.clk(clk), .rst(rst), .d(d), .q(q));
  always #5 clk = ~clk;

  task automatic cmp(string what);
    if (q !== exp_q) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t q=%b exp=%b", what, $time, q, exp_q);
    end
  endtask

  task automatic cycle(logic nr, logic nd);
    @(negedge clk); rst = nr; d = nd;
    @(posedge clk); exp_q = rst ? 1'b0 : d; #1 cmp("edge");
  endtask

  initial begin
    cycle(1, 1);
    cycle(0, 1); cycle(0, 0); cycle(0, 1);
    // rst asserted mid-cycle must not clear q before the edge
    @(negedge clk); d = 1; rst = 1; #1 if (q !== 1'b1) begin errors++; $display("CHECK FAIL reset not synchronous"); end
    @(posedge clk); exp_q = 0; #1 cmp("sync reset");
    cycle(1, 1); cycle(0, 1);
    for (int i = 0; i < 500; i++) cycle((rnd() % 10) == 0, rnd() % 2);
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

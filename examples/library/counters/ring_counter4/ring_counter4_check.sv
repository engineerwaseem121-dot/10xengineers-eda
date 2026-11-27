module ring_counter4_check;
  logic clk = 0, rst_n = 1;
  logic [3:0] q;
  int pos;   // model: index of the hot bit
  int errors = 0;
  integer seed = 4;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  ring_counter4 dut (.clk(clk), .rst_n(rst_n), .q(q));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (q !== (4'b0001 << pos)) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t q=%b pos=%0d", what, $time, q, pos);
    end
  endtask
  task automatic cycle(logic r);
    @(negedge clk);
    if (!r) begin rst_n = 0; #1 pos = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk); if (rst_n) pos = (pos + 1) % 4; #1 cmp("edge");
  endtask
  initial begin
    pos = 0;
    #1 rst_n = 0; #1 cmp("reset");
    for (int i = 0; i < 10; i++) cycle(1);
    cycle(0); cycle(1); cycle(1);
    for (int i = 0; i < 500; i++) cycle((rnd() % 30) != 0);
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

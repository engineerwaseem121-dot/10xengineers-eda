module up_counter4_check;
  logic clk = 0, rst_n = 1, en = 0;
  logic [3:0] count;
  int exp_c;
  int errors = 0;
  integer seed = 11;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  up_counter4 dut (.clk(clk), .rst_n(rst_n), .en(en), .count(count));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (count !== exp_c[3:0]) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t count=%0d exp=%0d", what, $time, count, exp_c);
    end
  endtask
  task automatic cycle(logic r, logic e);
    @(negedge clk); en = e;
    if (!r) begin rst_n = 0; #1 exp_c = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk); if (rst_n && en) exp_c = (exp_c + 1) % 16; #1 cmp("edge");
  endtask
  initial begin
    exp_c = 0;
    #1 rst_n = 0; #1 cmp("reset");
    cycle(1, 1); cycle(1, 1); cycle(1, 0);
    for (int i = 0; i < 20; i++) cycle(1, 1);   // passes the 15 -> 0 wrap
    cycle(1, 0); cycle(0, 1); cycle(1, 1);
    for (int i = 0; i < 500; i++) cycle((rnd() % 80) != 0, (rnd() % 4) != 0);
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

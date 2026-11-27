module rom16x8_check;
  logic clk = 0, rst_n = 1;
  logic [3:0] addr = 0;
  logic [7:0] dout, exp_d;
  int errors = 0;
  integer seed = 1608;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  rom16x8 dut (.clk(clk), .rst_n(rst_n), .addr(addr), .dout(dout));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (dout !== exp_d) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t addr=%0d dout=%0d exp=%0d", what, $time, addr, dout, exp_d);
    end
  endtask
  task automatic cycle(logic r, logic [3:0] a);
    @(negedge clk); addr = a;
    if (!r) begin rst_n = 0; #1 exp_d = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk); if (rst_n) exp_d = addr * addr; #1 cmp("edge");
  endtask
  initial begin
    exp_d = 0;
    #1 rst_n = 0; #1 cmp("reset");
    cycle(1, 3); cycle(1, 15); cycle(1, 0); cycle(1, 12);
    for (int i = 0; i < 16; i++) cycle(1, i);
    cycle(0, 9); cycle(1, 9);
    for (int i = 0; i < 500; i++) cycle((rnd() % 200) != 0, rnd());
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

module register8_load_check;
  logic clk = 0, rst_n = 1, load = 0;
  logic [7:0] din = 0, dout, exp_q;
  int errors = 0;
  integer seed = 808;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  register8_load dut (.clk(clk), .rst_n(rst_n), .load(load), .din(din), .dout(dout));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (dout !== exp_q) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t dout=%h exp=%h", what, $time, dout, exp_q);
    end
  endtask
  task automatic cycle(logic r, logic l, logic [7:0] nd);
    @(negedge clk); load = l; din = nd;
    if (!r) begin rst_n = 0; #1 exp_q = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk); if (rst_n && load) exp_q = din; #1 cmp("edge");
  endtask
  initial begin
    #1 rst_n = 0; exp_q = 0; #1 cmp("reset");
    cycle(1, 1, 8'hA5); cycle(1, 0, 8'h3C); cycle(1, 1, 8'h3C); cycle(1, 0, 8'hFF);
    cycle(1, 1, 8'hFF); cycle(1, 1, 8'h00); cycle(1, 1, 8'h80); cycle(0, 1, 8'h01); cycle(1, 0, 8'h55);
    for (int i = 0; i < 500; i++) cycle((rnd() % 40) != 0, rnd() % 2, rnd());
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

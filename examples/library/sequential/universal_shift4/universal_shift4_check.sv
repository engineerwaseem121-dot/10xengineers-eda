module universal_shift4_check;
  logic clk = 0, rst_n = 1, sl_in = 0, sr_in = 0;
  logic [1:0] mode = 0;
  logic [3:0] din = 0, q, exp_q;
  int errors = 0;
  integer seed = 4444;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  universal_shift4 dut (.clk(clk), .rst_n(rst_n), .mode(mode), .sl_in(sl_in), .sr_in(sr_in), .din(din), .q(q));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (q !== exp_q) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t mode=%b q=%b exp=%b", what, $time, mode, q, exp_q);
    end
  endtask
  task automatic cycle(logic r, logic [1:0] m, logic l, logic rr, logic [3:0] d);
    @(negedge clk); mode = m; sl_in = l; sr_in = rr; din = d;
    if (!r) begin rst_n = 0; #1 exp_q = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk);
    if (rst_n) begin
      if (mode == 2'b01)      exp_q = {exp_q[2:0], sl_in};
      else if (mode == 2'b10) exp_q = {sr_in, exp_q[3:1]};
      else if (mode == 2'b11) exp_q = din;
    end
    #1 cmp("edge");
  endtask
  initial begin
    #1 rst_n = 0; exp_q = 0; #1 cmp("reset");
    cycle(1, 2'b11, 0, 0, 4'b1001); cycle(1, 2'b01, 1, 0, 0); cycle(1, 2'b10, 0, 0, 0);
    cycle(1, 2'b10, 0, 1, 0); cycle(1, 2'b00, 1, 1, 4'hF);
    for (int i = 0; i < 5; i++) cycle(1, 2'b01, 1, 0, 0);
    for (int i = 0; i < 5; i++) cycle(1, 2'b10, 0, 0, 0);
    cycle(0, 2'b11, 0, 0, 4'hA);
    for (int i = 0; i < 500; i++) cycle((rnd() % 60) != 0, rnd(), rnd(), rnd(), rnd());
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

module ram_sp_check;
  logic clk = 0, rst_n = 1, we = 0;
  logic [3:0] addr = 0;
  logic [7:0] din = 0, dout;
  logic [7:0] model [0:15];
  logic [7:0] exp_d;
  int errors = 0;
  integer seed = 1601;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  ram_sp dut (.clk(clk), .rst_n(rst_n), .addr(addr), .we(we), .din(din), .dout(dout));
  always #5 clk = ~clk;
  task automatic clr(); for (int i = 0; i < 16; i++) model[i] = 0; exp_d = 0; endtask
  task automatic cmp(string what);
    if (dout !== exp_d) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t addr=%0d dout=%h exp=%h", what, $time, addr, dout, exp_d);
    end
  endtask
  task automatic cycle(logic r, logic [3:0] a, logic w, logic [7:0] d);
    @(negedge clk); addr = a; we = w; din = d;
    if (!r) begin rst_n = 0; #1 clr(); cmp("async reset"); end else rst_n = 1;
    @(posedge clk);
    if (rst_n) begin exp_d = model[addr]; if (we) model[addr] = din; end
    #1 cmp("edge");
  endtask
  initial begin
    clr();
    #1 rst_n = 0; #1 cmp("reset");
    cycle(1, 3, 1, 8'hAA); cycle(1, 3, 1, 8'hBB); cycle(1, 3, 0, 0); cycle(1, 5, 0, 0);
    for (int i = 0; i < 16; i++) cycle(1, i, 1, 8'h10 + i);
    for (int i = 0; i < 16; i++) cycle(1, 15 - i, 0, 8'hFF);
    cycle(1, 15, 1, 8'h00); cycle(1, 15, 0, 0);
    cycle(0, 2, 1, 8'h77); cycle(1, 2, 0, 0); cycle(1, 7, 0, 0);
    for (int i = 0; i < 500; i++) cycle((rnd() % 200) != 0, rnd(), rnd() % 2, rnd());
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

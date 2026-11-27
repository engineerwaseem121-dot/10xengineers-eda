module ram_dp_check;
  logic clk = 0, rst_n = 1, we = 0;
  logic [3:0] waddr = 0, raddr = 0;
  logic [7:0] wdata = 0, rdata;
  logic [7:0] model [0:15];
  logic [7:0] exp_d;
  int errors = 0;
  integer seed = 1602;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  ram_dp dut (.clk(clk), .rst_n(rst_n), .we(we), .waddr(waddr), .wdata(wdata), .raddr(raddr), .rdata(rdata));
  always #5 clk = ~clk;
  task automatic clr(); for (int i = 0; i < 16; i++) model[i] = 0; exp_d = 0; endtask
  task automatic cmp(string what);
    if (rdata !== exp_d) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t raddr=%0d rdata=%h exp=%h", what, $time, raddr, rdata, exp_d);
    end
  endtask
  task automatic cycle(logic r, logic w, logic [3:0] wa, logic [7:0] wd, logic [3:0] ra);
    @(negedge clk); we = w; waddr = wa; wdata = wd; raddr = ra;
    if (!r) begin rst_n = 0; #1 clr(); cmp("async reset"); end else rst_n = 1;
    @(posedge clk);
    if (rst_n) begin exp_d = model[raddr]; if (we) model[waddr] = wdata; end
    #1 cmp("edge");
  endtask
  initial begin
    clr();
    #1 rst_n = 0; #1 cmp("reset");
    cycle(1, 1, 2, 8'h5A, 2); cycle(1, 1, 4, 8'hC3, 2); cycle(1, 0, 0, 0, 4);
    cycle(1, 1, 4, 8'h11, 4); cycle(1, 0, 0, 0, 4);
    for (int i = 0; i < 16; i++) cycle(1, 1, i, ~i, (i + 15) % 16);
    for (int i = 0; i < 16; i++) cycle(1, 0, i, 8'hEE, i);
    cycle(0, 1, 1, 8'h99, 1); cycle(1, 0, 0, 0, 1);
    for (int i = 0; i < 500; i++) cycle((rnd() % 200) != 0, rnd() % 2, rnd(), rnd(), rnd());
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

module sipo_shift_check;
  logic clk = 0, rst_n = 1, sin = 0;
  logic [7:0] pout, exp_p;
  int errors = 0;
  integer seed = 64;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  sipo_shift dut (.clk(clk), .rst_n(rst_n), .sin(sin), .pout(pout));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (pout !== exp_p) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t pout=%h exp=%h", what, $time, pout, exp_p);
    end
  endtask
  task automatic cycle(logic r, logic ns);
    @(negedge clk); sin = ns;
    if (!r) begin rst_n = 0; #1 exp_p = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk); if (rst_n) exp_p = (exp_p << 1) | sin; #1 cmp("edge");
  endtask
  initial begin
    logic [7:0] pat;
    #1 rst_n = 0; exp_p = 0; #1 cmp("reset");
    pat = 8'b10110010;
    for (int i = 7; i >= 0; i--) cycle(1, pat[i]);
    if (pout !== 8'hB2) begin errors++; $display("CHECK FAIL example pout=%h", pout); end
    for (int i = 0; i < 8; i++) cycle(1, 1);
    cycle(0, 1);
    for (int i = 0; i < 500; i++) cycle((rnd() % 60) != 0, rnd() % 2);
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

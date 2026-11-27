module siso_shift_check;
  logic clk = 0, rst_n = 1, sin = 0;
  logic sout;
  logic hist [0:7];   // model: last 8 sampled bits, hist[0] newest
  int errors = 0;
  integer seed = 31;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  siso_shift dut (.clk(clk), .rst_n(rst_n), .sin(sin), .sout(sout));
  always #5 clk = ~clk;
  task automatic clr(); for (int i = 0; i < 8; i++) hist[i] = 0; endtask
  task automatic cmp(string what);
    if (sout !== hist[7]) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t sout=%b exp=%b", what, $time, sout, hist[7]);
    end
  endtask
  task automatic cycle(logic r, logic ns);
    @(negedge clk); sin = ns;
    if (!r) begin rst_n = 0; #1 clr(); cmp("async reset"); end else rst_n = 1;
    @(posedge clk);
    if (rst_n) begin for (int i = 7; i > 0; i--) hist[i] = hist[i-1]; hist[0] = sin; end
    #1 cmp("edge");
  endtask
  initial begin
    #1 rst_n = 0; clr(); #1 cmp("reset");
    cycle(1, 1); for (int i = 0; i < 10; i++) cycle(1, 0);
    for (int i = 0; i < 10; i++) cycle(1, 1);
    cycle(0, 1); for (int i = 0; i < 9; i++) cycle(1, 1);
    for (int i = 0; i < 500; i++) cycle((rnd() % 60) != 0, rnd() % 2);
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

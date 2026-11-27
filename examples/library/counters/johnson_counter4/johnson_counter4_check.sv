module johnson_counter4_check;
  logic clk = 0, rst_n = 1;
  logic [3:0] q;
  logic [3:0] seq [0:7];
  int idx;
  int errors = 0;
  integer seed = 8;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  johnson_counter4 dut (.clk(clk), .rst_n(rst_n), .q(q));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (q !== seq[idx]) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t q=%b exp=%b", what, $time, q, seq[idx]);
    end
  endtask
  task automatic cycle(logic r);
    @(negedge clk);
    if (!r) begin rst_n = 0; #1 idx = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk); if (rst_n) idx = (idx + 1) % 8; #1 cmp("edge");
  endtask
  initial begin
    seq[0] = 4'b0000; seq[1] = 4'b0001; seq[2] = 4'b0011; seq[3] = 4'b0111;
    seq[4] = 4'b1111; seq[5] = 4'b1110; seq[6] = 4'b1100; seq[7] = 4'b1000;
    idx = 0;
    #1 rst_n = 0; #1 cmp("reset");
    for (int i = 0; i < 18; i++) cycle(1);
    cycle(0); cycle(1); cycle(1);
    for (int i = 0; i < 500; i++) cycle((rnd() % 30) != 0);
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

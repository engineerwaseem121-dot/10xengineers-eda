module edge_detector_check;
  logic clk = 0, rst_n = 1, sig = 0;
  logic rise, fall;
  logic prev, exp_r, exp_f;
  int errors = 0;
  integer seed = 1357;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  edge_detector dut (.clk(clk), .rst_n(rst_n), .sig(sig), .rise(rise), .fall(fall));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (rise !== exp_r || fall !== exp_f) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t rise=%b fall=%b exp=%b/%b", what, $time, rise, fall, exp_r, exp_f);
    end
  endtask
  task automatic cycle(logic r, logic s);
    @(negedge clk); sig = s;
    if (!r) begin rst_n = 0; #1 prev = 0; exp_r = 0; exp_f = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk);
    if (rst_n) begin
      exp_r = (prev == 1'b0 && sig == 1'b1);
      exp_f = (prev == 1'b1 && sig == 1'b0);
      prev = sig;
    end
    #1 cmp("edge");
  endtask
  initial begin
    prev = 0; exp_r = 0; exp_f = 0;
    #1 rst_n = 0; #1 cmp("reset");
    cycle(1, 0); cycle(1, 1); cycle(1, 1); cycle(1, 0); cycle(1, 0); cycle(1, 1);
    cycle(1, 0); cycle(1, 1); cycle(1, 0);
    cycle(0, 1); cycle(1, 1); cycle(1, 1);
    for (int i = 0; i < 500; i++) cycle((rnd() % 60) != 0, rnd() % 2);
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

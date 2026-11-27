module debouncer_check;
  logic clk = 0, rst_n = 1, din = 0;
  logic dout4, dout1, dout7;
  // Model: count consecutive samples that differ from the expected output; flip after N of them.
  logic e4, e1, e7;
  int errors = 0;
  integer seed = 9090;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  debouncer #(.STABLE_CYCLES(4)) dut4 (.clk(clk), .rst_n(rst_n), .din(din), .dout(dout4));
  debouncer #(.STABLE_CYCLES(1)) dut1 (.clk(clk), .rst_n(rst_n), .din(din), .dout(dout1));
  debouncer #(.STABLE_CYCLES(7)) dut7 (.clk(clk), .rst_n(rst_n), .din(din), .dout(dout7));
  always #5 clk = ~clk;
  int run4, run1, run7;  // count of consecutive samples differing from model output since last flip
  task automatic cmp(string what);
    if (dout4 !== e4 || dout1 !== e1 || dout7 !== e7) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t dout(4,1,7)=%b%b%b exp=%b%b%b", what, $time, dout4, dout1, dout7, e4, e1, e7);
    end
  endtask
  task automatic step_model(inout logic e, inout int run, input int n);
    if (din != e) run++; else run = 0;
    if (run >= n) begin e = din; run = 0; end
  endtask
  task automatic cycle(logic r, logic d);
    @(negedge clk); din = d;
    if (!r) begin rst_n = 0; #1 e4 = 0; e1 = 0; e7 = 0; run4 = 0; run1 = 0; run7 = 0; cmp("async reset"); end
    else rst_n = 1;
    @(posedge clk);
    if (rst_n) begin step_model(e4, run4, 4); step_model(e1, run1, 1); step_model(e7, run7, 7); end
    #1 cmp("edge");
  endtask
  initial begin
    e4 = 0; e1 = 0; e7 = 0; run4 = 0; run1 = 0; run7 = 0;
    #1 rst_n = 0; #1 cmp("reset");
    // example from SPEC
    cycle(1,1); cycle(1,1); cycle(1,0); cycle(1,1); cycle(1,1); cycle(1,1);
    if (dout4 !== 0) begin errors++; $display("CHECK FAIL example early"); end
    cycle(1,1);
    if (dout4 !== 1) begin errors++; $display("CHECK FAIL example edge 7"); end
    cycle(1,0); cycle(1,0); cycle(1,1);
    for (int i = 0; i < 10; i++) cycle(1, 0);
    for (int i = 0; i < 10; i++) cycle(1, 1);
    cycle(0, 1); cycle(1, 1);
    // random: mostly slow-changing input with bursts of bouncing
    for (int i = 0; i < 500; i++) begin
      logic nd;
      if ((rnd() % 4) == 0) nd = rnd() % 2; else nd = din;
      cycle((rnd() % 100) != 0, nd);
    end
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

module piso_shift_check;
  logic clk = 0, rst_n = 1, load = 0;
  logic [7:0] pin = 0;
  logic sout;
  logic [7:0] word; int idx;   // model: current word and index of the bit on sout (8 = none)
  int errors = 0;
  integer seed = 77;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  function automatic logic exp_s(); exp_s = (idx < 8) ? word[7 - idx] : 1'b0; endfunction
  piso_shift dut (.clk(clk), .rst_n(rst_n), .load(load), .pin(pin), .sout(sout));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (sout !== exp_s()) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t sout=%b exp=%b", what, $time, sout, exp_s());
    end
  endtask
  task automatic cycle(logic r, logic l, logic [7:0] p);
    @(negedge clk); load = l; pin = p;
    if (!r) begin rst_n = 0; #1 idx = 8; cmp("async reset"); end else rst_n = 1;
    @(posedge clk);
    if (rst_n) begin
      if (load) begin word = pin; idx = 0; end
      else if (idx < 8) idx++;
    end
    #1 cmp("edge");
  endtask
  initial begin
    word = 0; idx = 8;
    #1 rst_n = 0; #1 cmp("reset");
    cycle(1, 1, 8'b1011_0001); for (int i = 0; i < 9; i++) cycle(1, 0, 8'hFF);
    cycle(1, 1, 8'hFF); cycle(1, 0, 0); cycle(1, 0, 0); cycle(1, 1, 8'h80); cycle(1, 0, 0);
    cycle(1, 1, 8'h01); cycle(0, 0, 0); cycle(1, 0, 0);
    for (int i = 0; i < 500; i++) cycle((rnd() % 60) != 0, (rnd() % 8) == 0, rnd());
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

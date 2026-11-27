module gray_counter_check;
  logic clk = 0, rst_n = 1, en = 0;
  logic [3:0] gray;
  logic [5:0] gray6;
  int n;            // model: number of enabled edges since reset
  logic [3:0] prev4;
  int errors = 0;
  integer seed = 1023;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  // independent model: build Gray code bit by bit from the definition g[i] = b[i+1] xor b[i]
  function automatic logic [7:0] to_gray(int value, int w);
    logic [7:0] b, g;
    b = value % (1 << w);
    g = 0;
    for (int i = 0; i < w; i++) g[i] = (i == w - 1) ? b[i] : (b[i+1] != b[i]);
    return g;
  endfunction
  function automatic int ones4(logic [3:0] v); ones4 = v[0] + v[1] + v[2] + v[3]; endfunction
  gray_counter #(.WIDTH(4)) dut  (.clk(clk), .rst_n(rst_n), .en(en), .gray(gray));
  gray_counter #(.WIDTH(6)) dut6 (.clk(clk), .rst_n(rst_n), .en(en), .gray(gray6));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (gray !== to_gray(n, 4) || gray6 !== to_gray(n, 6)) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t gray=%b exp=%b gray6=%b exp=%b", what, $time, gray, to_gray(n,4), gray6, to_gray(n,6));
    end
  endtask
  task automatic cycle(logic r, logic e);
    @(negedge clk); en = e; prev4 = gray;
    if (!r) begin rst_n = 0; #1 n = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk); if (rst_n && en) n = n + 1; #1 cmp("edge");
    if (rst_n && en && ones4(gray ^ prev4) != 1) begin errors++; $display("CHECK FAIL not one-bit step %b -> %b", prev4, gray); end
  endtask
  initial begin
    n = 0;
    #1 rst_n = 0; #1 cmp("reset");
    for (int i = 0; i < 70; i++) cycle(1, 1);   // covers 4-bit and 6-bit wrap
    cycle(1, 0); cycle(1, 0); cycle(0, 1); cycle(1, 1);
    for (int i = 0; i < 500; i++) cycle((rnd() % 100) != 0, (rnd() % 4) != 0);
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

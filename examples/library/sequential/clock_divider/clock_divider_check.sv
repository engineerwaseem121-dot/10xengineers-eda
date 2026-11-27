module clock_divider_check;
  logic clk = 0, rst_n = 1;
  logic o4, o2, o6, o10;
  int n;          // edges since reset release
  int errors = 0;
  integer seed = 246;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  // model: after n edges, the output has toggled floor(n / (DIV/2)) times
  function automatic logic model(int div); model = ((n / (div / 2)) % 2) == 1; endfunction
  clock_divider #(.DIV(4))  d4  (.clk(clk), .rst_n(rst_n), .clk_out(o4));
  clock_divider #(.DIV(2))  d2  (.clk(clk), .rst_n(rst_n), .clk_out(o2));
  clock_divider #(.DIV(6))  d6  (.clk(clk), .rst_n(rst_n), .clk_out(o6));
  clock_divider #(.DIV(10)) d10 (.clk(clk), .rst_n(rst_n), .clk_out(o10));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (o4 !== model(4) || o2 !== model(2) || o6 !== model(6) || o10 !== model(10)) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t n=%0d out(4,2,6,10)=%b%b%b%b", what, $time, n, o4, o2, o6, o10);
    end
  endtask
  task automatic cycle(logic r);
    @(negedge clk);
    if (!r) begin rst_n = 0; #1 n = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk); if (rst_n) n++; #1 cmp("edge");
  endtask
  initial begin
    int hi;
    n = 0;
    #1 rst_n = 0; #1 cmp("reset");
    for (int i = 0; i < 40; i++) cycle(1);
    // duty cycle of DIV=4 over 40 edges
    hi = 0;
    for (int i = 0; i < 40; i++) begin cycle(1); if (o4) hi++; end
    if (hi != 20) begin errors++; $display("CHECK FAIL duty hi=%0d of 40", hi); end
    cycle(0); cycle(0);
    for (int i = 0; i < 500; i++) cycle((rnd() % 50) != 0);
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

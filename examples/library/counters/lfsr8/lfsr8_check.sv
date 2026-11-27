module lfsr8_check;
  logic clk = 0, rst_n = 1, en = 0;
  logic [7:0] q;
  logic [8:1] m;   // model register numbered 1..8 like the taps (m[8] = oldest)
  int errors = 0;
  integer seed = 255;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  lfsr8 dut (.clk(clk), .rst_n(rst_n), .en(en), .q(q));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (q !== m) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t q=%h exp=%h", what, $time, q, m);
    end
  endtask
  task automatic cycle(logic r, logic e);
    logic newbit;
    @(negedge clk); en = e;
    if (!r) begin rst_n = 0; #1 m = 8'h01; cmp("async reset"); end else rst_n = 1;
    @(posedge clk);
    if (rst_n && en) begin newbit = m[8] ^ m[6] ^ m[5] ^ m[4]; m = {m[7:1], newbit}; end
    #1 cmp("edge");
  endtask
  initial begin
    bit seen [0:255];
    int distinct;
    m = 8'h01;
    #1 rst_n = 0; #1 cmp("reset");
    // example values
    cycle(1, 1); cycle(1, 1); cycle(1, 1); cycle(1, 1);
    if (q !== 8'h11) begin errors++; $display("CHECK FAIL example q=%h", q); end
    // period check: 255 steps visit every non-zero state and come back to the start
    for (int i = 0; i < 256; i++) seen[i] = 0;
    distinct = 0;
    for (int i = 0; i < 255; i++) begin
      if (!seen[q]) distinct++;
      seen[q] = 1;
      cycle(1, 1);
    end
    if (distinct != 255 || seen[0]) begin errors++; $display("CHECK FAIL period distinct=%0d", distinct); end
    if (q !== 8'h11) begin errors++; $display("CHECK FAIL period not 255, q=%h", q); end
    cycle(1, 0); cycle(0, 1); cycle(1, 1);
    for (int i = 0; i < 500; i++) cycle((rnd() % 100) != 0, (rnd() % 4) != 0);
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

module fifo_almost_check;
  logic clk = 0, rst_n = 1, wr_en = 0, rd_en = 0;
  logic [7:0] din = 0;
  // instance A: defaults (DEPTH 8, AF_GAP 2, AE_GAP 2); instance B: DEPTH 16, AF_GAP 3, AE_GAP 5
  logic [7:0] dout_a, dout_b;
  logic full_a, empty_a, af_a, ae_a, full_b, empty_b, af_b, ae_b;
  logic [3:0] count_a;
  logic [4:0] count_b;
  logic [7:0] mq [0:1][0:15];   // model queues, index 0 = instance A, 1 = instance B
  int na, nb;
  logic [7:0] ea, eb;
  int errors = 0, saw_af = 0, saw_full = 0;
  integer seed = 8118;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  fifo_almost dut_a (.clk(clk), .rst_n(rst_n), .wr_en(wr_en), .din(din), .rd_en(rd_en), .dout(dout_a),
                     .full(full_a), .empty(empty_a), .almost_full(af_a), .almost_empty(ae_a), .count(count_a));
  fifo_almost #(.DEPTH(16), .AF_GAP(3), .AE_GAP(5)) dut_b (.clk(clk), .rst_n(rst_n), .wr_en(wr_en), .din(din),
                     .rd_en(rd_en), .dout(dout_b), .full(full_b), .empty(empty_b), .almost_full(af_b),
                     .almost_empty(ae_b), .count(count_b));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (dout_a !== ea || count_a !== na || full_a !== (na == 8) || empty_a !== (na == 0) ||
        af_a !== (na >= 6) || ae_a !== (na <= 2)) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL A %s t=%0t dout=%h exp=%h count=%0d exp=%0d f=%b e=%b af=%b ae=%b",
                                what, $time, dout_a, ea, count_a, na, full_a, empty_a, af_a, ae_a);
    end
    if (dout_b !== eb || count_b !== nb || full_b !== (nb == 16) || empty_b !== (nb == 0) ||
        af_b !== (nb >= 13) || ae_b !== (nb <= 5)) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL B %s t=%0t dout=%h exp=%h count=%0d exp=%0d f=%b e=%b af=%b ae=%b",
                                what, $time, dout_b, eb, count_b, nb, full_b, empty_b, af_b, ae_b);
    end
  endtask
  task automatic model_step(int k, int depth, inout int n, inout logic [7:0] e);
    logic can_w, can_r;
    can_w = wr_en && (n < depth);
    can_r = rd_en && (n > 0);
    if (can_r) begin e = mq[k][0]; for (int i = 0; i < 15; i++) mq[k][i] = mq[k][i+1]; n--; end
    if (can_w) begin mq[k][n] = din; n++; end
  endtask
  task automatic cycle(logic r, logic w, logic [7:0] d, logic rd);
    @(negedge clk); wr_en = w; din = d; rd_en = rd;
    if (!r) begin rst_n = 0; #1 na = 0; nb = 0; ea = 0; eb = 0; cmp("async reset"); end else rst_n = 1;
    @(posedge clk);
    if (rst_n) begin model_step(0, 8, na, ea); model_step(1, 16, nb, eb); end
    #1 cmp("edge");
    if (af_a) saw_af++;
    if (full_b) saw_full++;
  endtask
  initial begin
    int phase;
    na = 0; nb = 0; ea = 0; eb = 0;
    #1 rst_n = 0; #1 cmp("reset");
    for (int i = 0; i < 18; i++) cycle(1, 1, i, 0);        // fill both past full
    cycle(1, 1, 8'hEE, 1);
    for (int i = 0; i < 18; i++) cycle(1, 0, 0, 1);        // drain both past empty
    cycle(1, 1, 8'h42, 1); cycle(1, 1, 8'h43, 1);
    cycle(0, 1, 8'h44, 0); cycle(1, 1, 8'h45, 0);
    phase = 0;
    for (int i = 0; i < 500; i++) begin
      if ((i % 40) == 0) phase = rnd() % 3;
      case (phase)
        0: cycle((rnd() % 250) != 0, (rnd() % 4) != 0, rnd(), (rnd() % 4) == 0);
        1: cycle((rnd() % 250) != 0, (rnd() % 4) == 0, rnd(), (rnd() % 4) != 0);
        default: cycle((rnd() % 250) != 0, rnd() % 2, rnd(), rnd() % 2);
      endcase
    end
    if (saw_af == 0 || saw_full == 0) begin errors++; $display("CHECK FAIL thresholds not reached"); end
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

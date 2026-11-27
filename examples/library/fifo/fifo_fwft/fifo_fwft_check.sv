module fifo_fwft_check;
  localparam int DEPTH = 8;
  logic clk = 0, rst_n = 1, wr_en = 0, rd_en = 0;
  logic [7:0] din = 0, dout;
  logic full, empty;
  logic [3:0] count;
  logic [7:0] q [0:DEPTH-1];
  int n;
  int errors = 0, writes_dropped = 0, reads_dropped = 0;
  integer seed = 8228;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  function automatic logic [7:0] head(); head = (n == 0) ? 8'h00 : q[0]; endfunction
  fifo_fwft dut (.clk(clk), .rst_n(rst_n), .wr_en(wr_en), .din(din), .rd_en(rd_en), .dout(dout),
                 .full(full), .empty(empty), .count(count));
  always #5 clk = ~clk;
  task automatic cmp(string what);
    if (dout !== head() || count !== n || full !== (n == DEPTH) || empty !== (n == 0)) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t dout=%h exp=%h count=%0d exp=%0d full=%b empty=%b",
                                what, $time, dout, head(), count, n, full, empty);
    end
  endtask
  task automatic cycle(logic r, logic w, logic [7:0] d, logic rd);
    logic can_w, can_r;
    @(negedge clk); wr_en = w; din = d; rd_en = rd;
    if (!r) begin rst_n = 0; #1 n = 0; cmp("async reset"); end
    else begin rst_n = 1; #1 cmp("before edge"); end
    @(posedge clk);
    if (rst_n) begin
      can_w = wr_en && (n < DEPTH);
      can_r = rd_en && (n > 0);
      if (wr_en && !can_w) writes_dropped++;
      if (rd_en && !can_r) reads_dropped++;
      if (can_r) begin for (int i = 0; i < DEPTH - 1; i++) q[i] = q[i+1]; n--; end
      if (can_w) begin q[n] = din; n++; end
    end
    #1 cmp("edge");
  endtask
  initial begin
    int phase;
    n = 0;
    #1 rst_n = 0; #1 cmp("reset");
    cycle(1, 1, 8'h11, 0); cycle(1, 1, 8'h22, 0); cycle(1, 0, 0, 1); cycle(1, 1, 8'h33, 1);
    cycle(1, 0, 0, 1); cycle(1, 0, 0, 1);
    for (int i = 0; i < 11; i++) cycle(1, 1, 8'hB0 + i, 0);
    cycle(1, 1, 8'hEE, 1); cycle(1, 1, 8'hEF, 0);
    for (int i = 0; i < 11; i++) cycle(1, 0, 0, 1);
    cycle(1, 1, 8'h55, 1); cycle(1, 1, 8'h66, 1);
    cycle(0, 1, 8'h77, 0); cycle(1, 1, 8'h78, 0); cycle(1, 0, 0, 1);
    phase = 0;
    for (int i = 0; i < 500; i++) begin
      if ((i % 40) == 0) phase = rnd() % 3;
      case (phase)
        0: cycle((rnd() % 250) != 0, (rnd() % 4) != 0, rnd(), (rnd() % 4) == 0);
        1: cycle((rnd() % 250) != 0, (rnd() % 4) == 0, rnd(), (rnd() % 4) != 0);
        default: cycle((rnd() % 250) != 0, rnd() % 2, rnd(), rnd() % 2);
      endcase
    end
    if (writes_dropped == 0 || reads_dropped == 0) begin errors++; $display("CHECK FAIL corner cases not hit"); end
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

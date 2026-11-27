module mac_unit_check;
  logic               clk = 0;
  logic               rst_n, clear, en;
  logic signed [7:0]  a, b;
  logic signed [19:0] acc;
  logic        [19:0] m;     // model accumulator (20-bit, wraps)
  int errors = 0;
  int seed = 32'h0BADF00D;

  mac_unit dut (.clk(clk), .rst_n(rst_n), .clear(clear), .en(en), .a(a), .b(b), .acc(acc));

  always #5 clk = ~clk;

  task automatic cmp(input string what);
    if (acc !== m) begin
      if (errors < 10) $display("mismatch (%s) at %0t: acc=%0d exp=%0d", what, $time, acc, $signed(m));
      errors++;
    end
  endtask

  // drive on the falling edge, update the model at the rising edge, compare after it
  task automatic cycle(input logic i_clear, input logic i_en, input int ia, input int ib);
    @(negedge clk);
    clear = i_clear; en = i_en; a = ia[7:0]; b = ib[7:0];
    @(posedge clk);
    if (clear)   m = 20'd0;
    else if (en) begin
      int p;
      p = ia * ib;            // exact signed product
      m = m + p[19:0];        // modulo 2^20
    end
    #1 cmp("cycle");
  endtask

  task automatic expect_val(input int v);
    if (acc !== v[19:0]) begin
      $display("example: acc=%0d exp=%0d", acc, v);
      errors++;
    end
  endtask

  initial begin
    rst_n = 0; clear = 0; en = 0; a = 0; b = 0;
    m = 0;
    #12 cmp("reset");
    @(negedge clk) rst_n = 1;

    // example sequence from SPEC.md
    cycle(0, 1, 3, 4);        expect_val(12);
    cycle(0, 1, -2, 5);       expect_val(2);
    cycle(0, 0, 100, 100);    expect_val(2);
    cycle(0, 1, -128, -128);  expect_val(16386);
    cycle(1, 1, 7, 7);        expect_val(0);
    cycle(0, 1, 127, -128);   expect_val(-16256);

    // wrap-around: 33 worst-case positive products
    cycle(1, 0, 0, 0);
    for (int i = 0; i < 33; i++) cycle(0, 1, -128, -128);

    // 500 random vectors
    for (int n = 0; n < 500; n++) begin
      int r, ra, rb;
      r  = $random(seed);
      ra = $random(seed) % 128;   // -127..127
      rb = $random(seed) % 129;   // -128..128 -> clip
      if (rb == 128) rb = -128;
      if (r[3:0] == 0) ra = -128;
      cycle((r[9:4] == 0), (r[11:10] != 0), ra, rb);
    end

    // asynchronous reset in the middle of a cycle
    @(negedge clk); en = 1; a = 8'sd5; b = 8'sd5;
    #2 rst_n = 0; m = 0;
    #1 cmp("async reset");
    @(negedge clk) begin rst_n = 1; en = 0; end
    cycle(0, 1, 9, -9);

    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

module crc16_ccitt_serial_check;
  logic        clk = 0;
  logic        rst_n, init, en, din;
  logic [15:0] crc;
  logic [15:0] m;      // model register
  int errors = 0;
  int seed = 32'h1234_5678;

  crc16_ccitt_serial dut (.clk(clk), .rst_n(rst_n), .init(init), .en(en), .din(din), .crc(crc));

  always #5 clk = ~clk;

  // model written from the per-bit equations in SPEC.md
  function automatic logic [15:0] step(input logic [15:0] c, input logic d);
    logic f;
    logic [15:0] n;
    f = c[15] ^ d;
    for (int i = 1; i < 16; i++) n[i] = c[i-1];
    n[0]  = f;
    n[5]  = c[4] ^ f;
    n[12] = c[11] ^ f;
    return n;
  endfunction

  task automatic cmp(input string what);
    if (crc !== m) begin
      if (errors < 10) $display("mismatch (%s) at %0t: crc=%h exp=%h", what, $time, crc, m);
      errors++;
    end
  endtask

  // drive on the falling edge, model update on the rising edge, compare just after it
  task automatic cycle(input logic i_init, input logic i_en, input logic i_din);
    @(negedge clk);
    init = i_init; en = i_en; din = i_din;
    @(posedge clk);
    if (rst_n) begin
      if (init)    m = 16'hFFFF;
      else if (en) m = step(m, din);
    end
    #1 cmp("cycle");
  endtask

  initial begin
    rst_n = 0; init = 0; en = 0; din = 0;
    m = 16'hFFFF;
    #12;
    cmp("reset");
    @(negedge clk) rst_n = 1;

    // known answer: "123456789" -> 0x29B1
    begin
      logic [7:0] msg;
      cycle(1, 0, 0);
      for (int b = 0; b < 9; b++)
        for (int k = 7; k >= 0; k--) begin msg = 8'h31 + b[7:0]; cycle(0, 1, msg[k]); end
      if (crc !== 16'h29B1) begin
        $display("known answer failed: crc=%h exp=29B1", crc);
        errors++;
      end
    end

    // single-bit examples from SPEC.md
    cycle(1, 0, 0); cycle(0, 1, 1);
    if (crc !== 16'hFFFE) begin $display("one bit 1: crc=%h exp FFFE", crc); errors++; end
    cycle(1, 0, 0); cycle(0, 1, 0);
    if (crc !== 16'hEFDF) begin $display("one bit 0: crc=%h exp EFDF", crc); errors++; end

    // 500 random vectors
    for (int n = 0; n < 500; n++) begin
      int r;
      r = $random(seed);
      cycle((r & 32'h1F) == 0, r[8] | r[9], r[12]);
    end

    // asynchronous reset in the middle of a cycle
    @(negedge clk); en = 1; din = 1;
    #2 rst_n = 0; m = 16'hFFFF;
    #1 cmp("async reset");
    @(negedge clk) begin rst_n = 1; en = 0; end
    cycle(0, 1, 0);

    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

module program_counter_check;
  logic clk = 0, rst_n = 1, en = 0, load = 0, branch = 0;
  logic [31:0] load_addr = 0, offset = 0;
  logic [31:0] pc, pc_v;
  longint exp_pc;
  longint exp_v;
  int errors = 0;
  integer seed = 32;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  program_counter dut (.clk(clk), .rst_n(rst_n), .en(en), .load(load), .load_addr(load_addr),
                       .branch(branch), .offset(offset), .pc(pc));
  program_counter #(.RESET_VECTOR(32'h8000_0000)) dutv (.clk(clk), .rst_n(rst_n), .en(en), .load(load),
                       .load_addr(load_addr), .branch(branch), .offset(offset), .pc(pc_v));
  always #5 clk = ~clk;
  function automatic longint nxt(longint cur);
    longint off;
    off = $signed(offset);           // sign-extend to 64 bits
    if (load)        return load_addr;
    else if (branch) return (cur + off) & 64'hFFFF_FFFF;
    else if (en)     return (cur + 4) & 64'hFFFF_FFFF;
    else             return cur;
  endfunction
  task automatic cmp(string what);
    if (pc !== exp_pc[31:0] || pc_v !== exp_v[31:0]) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t pc=%h exp=%h pc_v=%h exp=%h", what, $time, pc, exp_pc[31:0], pc_v, exp_v[31:0]);
    end
  endtask
  task automatic cycle(logic r, logic e, logic l, logic [31:0] la, logic b, logic [31:0] off);
    @(negedge clk); en = e; load = l; load_addr = la; branch = b; offset = off;
    if (!r) begin rst_n = 0; #1 exp_pc = 0; exp_v = 64'h8000_0000; cmp("async reset"); end else rst_n = 1;
    @(posedge clk); if (rst_n) begin exp_pc = nxt(exp_pc); exp_v = nxt(exp_v); end
    #1 cmp("edge");
  endtask
  initial begin
    exp_pc = 0; exp_v = 64'h8000_0000;
    #1 rst_n = 0; #1 cmp("reset");
    cycle(1, 1, 0, 0, 0, 0); cycle(1, 1, 0, 0, 0, 0);
    cycle(1, 1, 0, 0, 1, 32'hFFFF_FFF8);
    if (pc !== 0) begin errors++; $display("CHECK FAIL example branch back"); end
    cycle(1, 1, 1, 32'h0000_1000, 1, 32'h10);
    cycle(1, 0, 0, 0, 1, 32'h10);
    cycle(1, 0, 0, 0, 0, 0);
    if (pc !== 32'h1010) begin errors++; $display("CHECK FAIL example pc=%h", pc); end
    cycle(1, 0, 1, 32'hFFFF_FFFC, 0, 0); cycle(1, 1, 0, 0, 0, 0);     // wrap on +4
    cycle(1, 0, 0, 0, 1, 32'h8000_0000); cycle(1, 0, 0, 0, 1, 32'h8000_0000); // big offsets
    cycle(0, 1, 0, 0, 0, 0); cycle(1, 1, 0, 0, 0, 0);
    for (int i = 0; i < 500; i++)
      cycle((rnd() % 100) != 0, rnd() % 2, (rnd() % 8) == 0, rnd(), (rnd() % 4) == 0,
            (rnd() % 2) ? (rnd() % 256) - 128 : rnd());
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

module register_file_2r1w_check;
  logic clk = 0, rst_n = 1, we = 0;
  logic [2:0] ra1 = 0, ra2 = 0, wa = 0;
  logic [7:0] wd = 0, rd1, rd2;
  logic [7:0] model [0:7];
  int errors = 0;
  integer seed = 1610;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  register_file_2r1w dut (.clk(clk), .rst_n(rst_n), .ra1(ra1), .ra2(ra2), .rd1(rd1), .rd2(rd2),
                          .we(we), .wa(wa), .wd(wd));
  always #5 clk = ~clk;
  task automatic clr(); for (int i = 0; i < 8; i++) model[i] = 0; endtask
  task automatic cmp(string what);
    if (rd1 !== model[ra1] || rd2 !== model[ra2]) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL %s t=%0t ra1=%0d rd1=%h exp=%h ra2=%0d rd2=%h exp=%h",
                                what, $time, ra1, rd1, model[ra1], ra2, rd2, model[ra2]);
    end
  endtask
  task automatic cycle(logic r, logic w, logic [2:0] a, logic [7:0] d, logic [2:0] r1, logic [2:0] r2);
    @(negedge clk); we = w; wa = a; wd = d; ra1 = r1; ra2 = r2;
    if (!r) begin rst_n = 0; #1 clr(); cmp("async reset"); end
    else begin rst_n = 1; #1 cmp("comb read before edge"); end
    @(posedge clk);
    if (rst_n && we && wa != 0) model[wa] = wd;
    #1 cmp("after edge");
  endtask
  initial begin
    clr();
    #1 rst_n = 0; #1 cmp("reset");
    cycle(1, 0, 0, 0, 1, 2);
    cycle(1, 1, 1, 8'h3C, 1, 0); cycle(1, 1, 0, 8'hFF, 0, 1); cycle(1, 1, 7, 8'h81, 7, 7);
    for (int i = 0; i < 8; i++) cycle(1, 1, i, 8'hA0 + i, i, 7 - i);
    for (int i = 0; i < 8; i++) cycle(1, 0, i, 8'h00, i, i);
    cycle(0, 1, 3, 8'h33, 3, 3); cycle(1, 0, 0, 0, 3, 0);
    for (int i = 0; i < 500; i++) cycle((rnd() % 200) != 0, rnd() % 2, rnd(), rnd(), rnd(), rnd());
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

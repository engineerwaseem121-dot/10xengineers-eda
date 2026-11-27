module d_latch_check;
  logic en = 0, d = 0;
  logic q, exp_q;
  int errors = 0;
  integer seed = 2024;
  function automatic int unsigned rnd(); rnd = $random(seed); endfunction
  d_latch dut (.en(en), .d(d), .q(q));
  task automatic apply(logic ne, logic nd);
    en = ne; d = nd;
    #1;
    if (en) exp_q = d;
    if (q !== exp_q) begin
      errors++;
      if (errors < 10) $display("CHECK FAIL t=%0t en=%b d=%b q=%b exp=%b", $time, en, d, q, exp_q);
    end
    #4;
  endtask
  initial begin
    exp_q = 1'bx;
    apply(1, 1); apply(1, 0); apply(0, 1); apply(0, 0); apply(1, 1); apply(0, 0); apply(0, 1);
    apply(1, 0); apply(1, 1); apply(0, 0);
    for (int i = 0; i < 500; i++) apply(rnd() % 2, rnd() % 2);
    if (errors == 0) $display("CHECK PASS"); else $display("CHECK FAIL %0d errors", errors);
    $finish;
  end
endmodule

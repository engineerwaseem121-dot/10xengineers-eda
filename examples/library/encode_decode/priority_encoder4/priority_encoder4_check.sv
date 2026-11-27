module priority_encoder4_check;
  logic [3:0] in;
  logic [1:0] out, exp;
  logic valid, exp_v;
  int errors = 0;
  priority_encoder4 dut (.in(in), .out(out), .valid(valid));
  initial begin
    for (int v = 0; v < 16; v++) begin
      in = v[3:0];
      exp = 0; exp_v = 0;
      for (int i = 0; i < 4; i++) if (in[i]) begin exp = i[1:0]; exp_v = 1; end
      #1;
      if (out !== exp || valid !== exp_v) begin
        if (errors < 10) $display("mismatch in=%b out=%b/%b valid=%b/%b", in, out, exp, valid, exp_v);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

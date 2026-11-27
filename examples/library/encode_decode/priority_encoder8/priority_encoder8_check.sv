module priority_encoder8_check;
  logic [7:0] in;
  logic [2:0] out, exp;
  logic valid, exp_v;
  int errors = 0;
  priority_encoder8 dut (.in(in), .out(out), .valid(valid));
  initial begin
    for (int v = 0; v < 256; v++) begin
      in = v[7:0];
      exp = 0; exp_v = 0;
      for (int i = 7; i >= 0; i--) if (in[i] && !exp_v) begin exp = i[2:0]; exp_v = 1; end
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

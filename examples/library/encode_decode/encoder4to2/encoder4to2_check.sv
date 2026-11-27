module encoder4to2_check;
  logic [3:0] in;
  logic [1:0] out;
  logic [1:0] exp;
  int errors = 0;
  encoder4to2 dut (.in(in), .out(out));
  initial begin
    for (int v = 0; v < 16; v++) begin
      in = v[3:0];
      exp = 2'b00;
      for (int i = 0; i < 4; i++) if (in[i]) exp = exp | i[1:0];
      #1;
      if (out !== exp) begin
        if (errors < 10) $display("mismatch in=%b out=%b exp=%b", in, out, exp);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

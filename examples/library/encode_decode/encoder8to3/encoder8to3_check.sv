module encoder8to3_check;
  logic [7:0] in;
  logic [2:0] out;
  logic [2:0] exp;
  int errors = 0;
  encoder8to3 dut (.in(in), .out(out));
  initial begin
    for (int v = 0; v < 256; v++) begin
      in = v[7:0];
      exp = 3'b000;
      for (int i = 0; i < 8; i++) if (in[i]) exp = exp | i[2:0];
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

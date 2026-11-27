module decoder2to4_check;
  logic [1:0] in;
  logic [3:0] out, exp;
  int errors = 0;
  decoder2to4 dut (.in(in), .out(out));
  initial begin
    for (int v = 0; v < 4; v++) begin
      in = v[1:0];
      for (int i = 0; i < 4; i++) exp[i] = (i == v);
      #1;
      if (out !== exp) begin
        $display("mismatch in=%b out=%b exp=%b", in, out, exp);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

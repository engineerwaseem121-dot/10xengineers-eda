module decoder3to8_en_check;
  logic       en;
  logic [2:0] in;
  logic [7:0] out, exp;
  int errors = 0;
  decoder3to8_en dut (.en(en), .in(in), .out(out));
  initial begin
    for (int v = 0; v < 16; v++) begin
      {en, in} = v[3:0];
      for (int i = 0; i < 8; i++) exp[i] = en && (in == i);
      #1;
      if (out !== exp) begin
        $display("mismatch en=%b in=%b out=%b exp=%b", en, in, out, exp);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

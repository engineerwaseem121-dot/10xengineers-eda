module barrel_shifter8_check;
  logic [7:0] data, dout, exp;
  logic [2:0] shamt;
  logic dir;
  int errors = 0;
  barrel_shifter8 dut (.data(data), .shamt(shamt), .dir(dir), .dout(dout));
  initial begin
    for (int v = 0; v < 4096; v++) begin
      {dir, shamt, data} = v[11:0];
      for (int i = 0; i < 8; i++) begin
        if (dir == 0) exp[i] = (i >= shamt) ? data[i - shamt] : 1'b0;
        else          exp[i] = (i + shamt <= 7) ? data[i + shamt] : 1'b0;
      end
      #1;
      if (dout !== exp) begin
        if (errors < 10) $display("mismatch data=%b shamt=%0d dir=%b dout=%b exp=%b", data, shamt, dir, dout, exp);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

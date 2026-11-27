module bin2gray_check;
  logic [7:0] bin, gray, exp;
  logic [3:0] bin4, gray4, exp4, prev;
  int errors = 0;
  bin2gray #(.WIDTH(8)) dut (.bin(bin), .gray(gray));
  bin2gray #(.WIDTH(4)) dut4 (.bin(bin4), .gray(gray4));
  function automatic int ones4(input logic [3:0] x);
    int n;
    n = 0;
    for (int i = 0; i < 4; i++) if (x[i]) n++;
    return n;
  endfunction

  initial begin
    for (int v = 0; v < 256; v++) begin
      bin = v[7:0];
      exp[7] = bin[7];
      for (int i = 0; i < 7; i++) exp[i] = bin[i+1] ^ bin[i];
      #1;
      if (gray !== exp) begin
        if (errors < 10) $display("mismatch bin=%h gray=%h exp=%h", bin, gray, exp);
        errors++;
      end
    end
    // adjacent-code property on the 4-bit instance
    for (int v = 0; v < 16; v++) begin
      bin4 = v[3:0];
      exp4[3] = bin4[3];
      for (int i = 0; i < 3; i++) exp4[i] = bin4[i+1] ^ bin4[i];
      #1;
      if (gray4 !== exp4) begin
        if (errors < 10) $display("W4 mismatch bin=%h gray=%h exp=%h", bin4, gray4, exp4);
        errors++;
      end
      if (v > 0 && ones4(gray4 ^ prev) != 1) begin
        $display("W4 adjacent codes differ in more than one bit at %0d", v);
        errors++;
      end
      prev = gray4;
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

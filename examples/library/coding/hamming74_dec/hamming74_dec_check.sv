module hamming74_dec_check;
  logic [6:0] code;
  logic [3:0] data, exp_d;
  logic corrected, exp_c;
  int errors = 0;
  hamming74_dec dut (.code(code), .data(data), .corrected(corrected));

  // reference encoder written from the layout table in SPEC.md
  function automatic logic [6:0] enc(input logic [3:0] d);
    logic [6:0] c;
    c[2] = d[0]; c[4] = d[1]; c[5] = d[2]; c[6] = d[3];
    c[0] = c[2] ^ c[4] ^ c[6];
    c[1] = c[2] ^ c[5] ^ c[6];
    c[3] = c[4] ^ c[5] ^ c[6];
    return c;
  endfunction

  function automatic int ones7(input logic [6:0] x);
    int n;
    n = 0;
    for (int i = 0; i < 7; i++) if (x[i]) n++;
    return n;
  endfunction

  initial begin
    // every 7-bit word is within distance 1 of exactly one codeword (perfect code):
    // the model searches for that codeword by brute force
    for (int v = 0; v < 128; v++) begin
      int found;
      code = v[6:0];
      found = 0;
      for (int d = 0; d < 16; d++) begin
        int hd;
        hd = ones7(enc(d[3:0]) ^ code);
        if (hd <= 1) begin
          exp_d = d[3:0];
          exp_c = (hd == 1);
          found++;
        end
      end
      #1;
      if (found != 1) begin
        $display("model error: %0d codewords near %b", found, code);
        errors++;
      end else if (data !== exp_d || corrected !== exp_c) begin
        if (errors < 10) $display("mismatch code=%b data=%b/%b corrected=%b/%b", code, data, exp_d, corrected, exp_c);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

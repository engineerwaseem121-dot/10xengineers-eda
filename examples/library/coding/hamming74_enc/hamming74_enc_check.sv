module hamming74_enc_check;
  logic [3:0] data;
  logic [6:0] code;
  int errors = 0;
  hamming74_enc dut (.data(data), .code(code));

  // position k (1..7) of the codeword lives in code[k-1]
  function automatic logic pos(input logic [6:0] c, input int k);
    return c[k-1];
  endfunction

  initial begin
    for (int v = 0; v < 16; v++) begin
      data = v[3:0];
      #1;
      // data bits at positions 3,5,6,7
      if (pos(code,3) !== data[0] || pos(code,5) !== data[1] ||
          pos(code,6) !== data[2] || pos(code,7) !== data[3]) begin
        $display("data placement wrong data=%b code=%b", data, code);
        errors++;
      end
      // every parity group p (1,2,4): XOR over positions k with (k & p) != 0 must be 0
      for (int p = 1; p <= 4; p = p * 2) begin
        logic x;
        x = 0;
        for (int k = 1; k <= 7; k++) if ((k & p) != 0) x = x ^ pos(code, k);
        if (x !== 1'b0) begin
          $display("parity group %0d odd data=%b code=%b", p, data, code);
          errors++;
        end
      end
    end
    data = 4'b1011; #1;
    if (code !== 7'b1010101) begin $display("example 1011 -> %b exp 1010101", code); errors++; end
    data = 4'b1000; #1;
    if (code !== 7'b1001011) begin $display("example 1000 -> %b exp 1001011", code); errors++; end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

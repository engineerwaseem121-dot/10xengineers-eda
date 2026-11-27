module crc8_comb_check;
  logic [7:0] data, crc, exp;
  int errors = 0;
  crc8_comb dut (.data(data), .crc(crc));

  // model: long division of data * x^8 by the 9-bit polynomial 1_0000_0111
  function automatic logic [7:0] model(input logic [7:0] d);
    logic [15:0] dividend;
    dividend = {d, 8'h00};
    for (int k = 15; k >= 8; k--) begin
      if (dividend[k]) dividend = dividend ^ (16'h0107 << (k - 8));
    end
    return dividend[7:0];
  endfunction

  initial begin
    for (int v = 0; v < 256; v++) begin
      data = v[7:0];
      exp = model(data);
      #1;
      if (crc !== exp) begin
        if (errors < 10) $display("mismatch data=%h crc=%h exp=%h", data, crc, exp);
        errors++;
      end
    end
    // known values from SPEC.md
    data = 8'h31; #1; if (crc !== 8'h97) begin $display("crc(0x31)=%h exp 97", crc); errors++; end
    data = 8'hFF; #1; if (crc !== 8'hF3) begin $display("crc(0xFF)=%h exp F3", crc); errors++; end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

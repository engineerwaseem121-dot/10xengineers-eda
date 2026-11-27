module alu8_flags_check;
  logic [7:0] a, b, result;
  logic [3:0] op;
  logic zero, carry, negative, overflow;
  int errors = 0;
  int seed = 32'h00C0FFEE;

  alu8_flags dut (.a(a), .b(b), .op(op), .result(result),
                  .zero(zero), .carry(carry), .negative(negative), .overflow(overflow));

  // reference model from the SPEC.md table, using integer arithmetic
  task automatic check_one(input logic [3:0] o, input logic [7:0] x, input logic [7:0] y);
    int ua, ub, sa, sb, r, c, v, full;
    logic [7:0] er;
    op = o; a = x; b = y;
    ua = x; ub = y;
    sa = (ua >= 128) ? ua - 256 : ua;
    sb = (ub >= 128) ? ub - 256 : ub;
    c = 0; v = 0;
    case (o)
      0:  begin full = ua + ub; r = full % 256; c = (full > 255); v = (sa + sb > 127) || (sa + sb < -128); end
      1:  begin r = (ua - ub + 256) % 256; c = (ua < ub); v = (sa - sb > 127) || (sa - sb < -128); end
      2:  r = ua & ub;
      3:  r = ua | ub;
      4:  r = ua ^ ub;
      5:  r = 255 - (ua | ub);
      6:  r = 255 - ua;
      7:  begin r = (ua * 2) % 256; c = ua / 128; end
      8:  begin r = ua / 2; c = ua % 2; end
      9:  begin r = (sa >>> 1) & 255; c = ua % 2; end
      10: r = (sa < sb) ? 1 : 0;
      11: r = (ua < ub) ? 1 : 0;
      12: r = ua;
      13: r = ub;
      14: begin r = (ua + 1) % 256; c = (ua == 255); v = (sa + 1 > 127); end
      default: begin r = (ua + 255) % 256; c = (ua == 0); v = (sa - 1 < -128); end
    endcase
    er = r[7:0];
    #1;
    if (result !== er || zero !== (r == 0) || carry !== c[0] ||
        negative !== er[7] || overflow !== v[0]) begin
      if (errors < 10)
        $display("mismatch op=%0d a=%h b=%h result=%h/%h z=%b/%b c=%b/%b n=%b/%b v=%b/%b",
                 o, x, y, result, er, zero, (r == 0), carry, c[0], negative, er[7], overflow, v[0]);
      errors++;
    end
  endtask

  initial begin
    logic [7:0] corner [6];
    corner[0] = 8'h00; corner[1] = 8'h01; corner[2] = 8'h7F;
    corner[3] = 8'h80; corner[4] = 8'h81; corner[5] = 8'hFF;
    // directed: every op on every pair of corner values
    for (int o = 0; o < 16; o++)
      for (int i = 0; i < 6; i++)
        for (int j = 0; j < 6; j++)
          check_one(o[3:0], corner[i], corner[j]);
    // 500 random vectors
    for (int n = 0; n < 500; n++) begin
      int r;
      r = $random(seed);
      check_one(r[19:16], r[7:0], r[15:8]);
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

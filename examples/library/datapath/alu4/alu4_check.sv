module alu4_check;
  logic [3:0] a, b, result, exp;
  logic [2:0] op;
  logic zero, exp_z;
  int errors = 0;
  alu4 dut (.a(a), .b(b), .op(op), .result(result), .zero(zero));
  initial begin
    for (int v = 0; v < 2048; v++) begin
      int ia, ib, r;
      {op, a, b} = v[10:0];
      ia = a; ib = b;
      case (op)
        0: r = (ia + ib) % 16;
        1: r = (ia - ib + 16) % 16;
        2: r = ia & ib;
        3: r = ia | ib;
        4: r = ia ^ ib;
        5: r = 15 - ia;
        6: r = (ia * 2) % 16;
        default: r = ia / 2;
      endcase
      exp = r[3:0];
      exp_z = (r == 0);
      #1;
      if (result !== exp || zero !== exp_z) begin
        if (errors < 10) $display("mismatch op=%0d a=%h b=%h result=%h/%h zero=%b/%b", op, a, b, result, exp, zero, exp_z);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

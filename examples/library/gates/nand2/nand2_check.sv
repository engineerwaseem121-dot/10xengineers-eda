module nand2_check;
  logic a, b, y, exp_y;
  int errors = 0;
  nand2 dut (.a(a), .b(b), .y(y));
  initial begin
    for (int i = 0; i < 4; i++) begin
      {a, b} = i[1:0];
      #1;
      // truth table from SPEC.md
      case ({a, b})
        2'b00: exp_y = 1'b1;
        2'b01: exp_y = 1'b1;
        2'b10: exp_y = 1'b1;
        default: exp_y = 1'b0;
      endcase
      if (y !== exp_y) begin
        errors++;
        $display("CHECK FAIL a=%b b=%b y=%b expected=%b", a, b, y, exp_y);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

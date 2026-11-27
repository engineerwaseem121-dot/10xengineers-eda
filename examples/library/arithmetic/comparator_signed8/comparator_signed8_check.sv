module comparator_signed8_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] a, b;
  logic eq, lt, gt;
  int sa, sb, errors = 0;
  comparator_signed8 #(.WIDTH(WIDTH)) dut (.a(a), .b(b), .eq(eq), .lt(lt), .gt(gt));
  initial begin
    // 16 input bits: exhaustive
    for (int i = 0; i < (1 << (2*WIDTH)); i++) begin
      {a, b} = i[2*WIDTH-1:0];
      #1;
      sa = (int'(a) >= 128) ? int'(a) - 256 : int'(a);
      sb = (int'(b) >= 128) ? int'(b) - 256 : int'(b);
      if (eq !== (sa == sb) || lt !== (sa < sb) || gt !== (sa > sb)) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL a=%0d b=%0d eq=%b lt=%b gt=%b", sa, sb, eq, lt, gt);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

module abs8_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] a, y;
  int sa, e, errors = 0;
  abs8 #(.WIDTH(WIDTH)) dut (.a(a), .y(y));
  initial begin
    for (int i = 0; i < (1 << WIDTH); i++) begin
      a = i[WIDTH-1:0];
      #1;
      sa = (i >= 128) ? i - 256 : i;
      e  = (sa < 0) ? -sa : sa;
      if (y !== e[WIDTH-1:0]) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL a=%0d y=%0d expected=%0d", sa, y, e);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

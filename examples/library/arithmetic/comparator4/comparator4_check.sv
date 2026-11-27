module comparator4_check;
  localparam int WIDTH = 4;
  logic [WIDTH-1:0] a, b;
  logic eq, lt, gt;
  int d, errors = 0;
  comparator4 #(.WIDTH(WIDTH)) dut (.a(a), .b(b), .eq(eq), .lt(lt), .gt(gt));
  initial begin
    for (int i = 0; i < (1 << (2*WIDTH)); i++) begin
      {a, b} = i[2*WIDTH-1:0];
      #1;
      d = int'(a) - int'(b);
      if (eq !== (d == 0) || lt !== (d < 0) || gt !== (d > 0)) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL a=%0d b=%0d eq=%b lt=%b gt=%b", a, b, eq, lt, gt);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

module incrementer8_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] a, y;
  logic carry;
  int e, errors = 0;
  incrementer8 #(.WIDTH(WIDTH)) dut (.a(a), .y(y), .carry(carry));
  initial begin
    for (int i = 0; i < (1 << WIDTH); i++) begin
      a = i[WIDTH-1:0];
      #1;
      e = i + 1;
      if (y !== e[WIDTH-1:0] || carry !== (e == (1 << WIDTH))) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL a=%h y=%h carry=%b expected %0d", a, y, carry, e);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

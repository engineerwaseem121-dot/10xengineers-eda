module add_sub8_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] a, b, result;
  logic mode, carry_out, overflow;
  logic [WIDTH-1:0] e_result;
  logic e_carry, e_ovf;
  int ua, ub, sa, sb, ur, sr;
  int seed = 32'hA5D8;
  int errors = 0;
  add_sub8 #(.WIDTH(WIDTH)) dut (.a(a), .b(b), .mode(mode), .result(result),
                                 .carry_out(carry_out), .overflow(overflow));

  task automatic check_one();
    #1;
    ua = int'(a);  ub = int'(b);
    sa = (ua >= 128) ? ua - 256 : ua;
    sb = (ub >= 128) ? ub - 256 : ub;
    if (mode == 1'b0) begin
      ur = ua + ub;
      sr = sa + sb;
      e_carry = (ur >= 256);
    end else begin
      ur = ua - ub;
      sr = sa - sb;
      e_carry = (ua >= ub);     // carry = not borrow
    end
    e_result = ur[WIDTH-1:0];   // two's-complement wrap
    e_ovf = (sr > 127) || (sr < -128);
    if (result !== e_result || carry_out !== e_carry || overflow !== e_ovf) begin
      errors++;
      if (errors < 10)
        $display("CHECK FAIL a=%h b=%h mode=%b result=%h carry=%b ovf=%b expected %h %b %b",
                 a, b, mode, result, carry_out, overflow, e_result, e_carry, e_ovf);
    end
  endtask

  initial begin
    // directed corners
    a = 8'h7F; b = 8'h01; mode = 0; check_one();
    a = 8'hFF; b = 8'h01; mode = 0; check_one();
    a = 8'h80; b = 8'h80; mode = 0; check_one();
    a = 8'h80; b = 8'h01; mode = 1; check_one();
    a = 8'h7F; b = 8'hFF; mode = 1; check_one();
    a = 8'h00; b = 8'h00; mode = 1; check_one();
    a = 8'h05; b = 8'h06; mode = 1; check_one();
    // 17 input bits: 500 random vectors, fixed seed
    for (int i = 0; i < 500; i++) begin
      a = $random(seed); b = $random(seed); mode = $random(seed);
      check_one();
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

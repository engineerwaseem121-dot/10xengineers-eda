module ripple_adder8_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] a, b, sum;
  logic cin, cout;
  int seed = 32'h1234;
  int total, errors = 0;
  ripple_adder8 #(.WIDTH(WIDTH)) dut (.a(a), .b(b), .cin(cin), .sum(sum), .cout(cout));

  task automatic check_one();
    #1;
    total = int'(a) + int'(b) + int'(cin);
    if (sum !== total[WIDTH-1:0] || cout !== total[WIDTH]) begin
      errors++;
      if (errors < 10)
        $display("CHECK FAIL a=%h b=%h cin=%b sum=%h cout=%b expected total=%0d", a, b, cin, sum, cout, total);
    end
  endtask

  initial begin
    // directed corners
    a = 8'h00; b = 8'h00; cin = 0; check_one();
    a = 8'hFF; b = 8'h01; cin = 0; check_one();
    a = 8'hFF; b = 8'hFF; cin = 1; check_one();
    a = 8'h80; b = 8'h80; cin = 1; check_one();
    a = 8'h7F; b = 8'h00; cin = 1; check_one();
    // 17 input bits: 500 random vectors, fixed seed
    for (int i = 0; i < 500; i++) begin
      a = $random(seed); b = $random(seed); cin = $random(seed);
      check_one();
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

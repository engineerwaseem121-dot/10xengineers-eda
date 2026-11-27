module demux1to4_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] din, y0, y1, y2, y3;
  logic [WIDTH-1:0] e[4];
  logic [1:0] sel;
  int errors = 0;
  demux1to4 #(.WIDTH(WIDTH)) dut (.din(din), .sel(sel), .y0(y0), .y1(y1), .y2(y2), .y3(y3));
  initial begin
    // 10 input bits: exhaustive
    for (int i = 0; i < (1 << (WIDTH + 2)); i++) begin
      {sel, din} = i[WIDTH+1:0];
      #1;
      for (int k = 0; k < 4; k++) e[k] = (int'(sel) == k) ? din : {WIDTH{1'b0}};
      if (y0 !== e[0] || y1 !== e[1] || y2 !== e[2] || y3 !== e[3]) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL din=%h sel=%0d y=%h %h %h %h", din, sel, y0, y1, y2, y3);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

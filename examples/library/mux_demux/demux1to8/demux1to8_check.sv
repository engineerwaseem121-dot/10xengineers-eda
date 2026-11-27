module demux1to8_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] din;
  logic [2:0] sel;
  logic [8*WIDTH-1:0] dout, e;
  int errors = 0;
  demux1to8 #(.WIDTH(WIDTH)) dut (.din(din), .sel(sel), .dout(dout));
  initial begin
    // 11 input bits: exhaustive
    for (int i = 0; i < (1 << (WIDTH + 3)); i++) begin
      {sel, din} = i[WIDTH+2:0];
      #1;
      e = '0;
      for (int k = 0; k < 8; k++)
        if (int'(sel) == k)
          for (int j = 0; j < WIDTH; j++) e[k*WIDTH + j] = din[j];
      if (dout !== e) begin
        errors++;
        if (errors < 10) $display("CHECK FAIL din=%h sel=%0d dout=%h expected=%h", din, sel, dout, e);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

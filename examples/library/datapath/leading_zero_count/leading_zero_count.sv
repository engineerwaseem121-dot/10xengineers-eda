// leading_zero_count: number of zero bits above the highest set bit of in[15:0]
module leading_zero_count (
  input  logic [15:0] in,
  output logic [4:0]  count
);
  always_comb begin
    count = 5'd16;               // all zero
    // scan upward: the highest set bit is seen last and wins
    for (int i = 0; i < 16; i++) begin
      if (in[i]) count = 5'(15 - i);
    end
  end
endmodule

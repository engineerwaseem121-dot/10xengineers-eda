// popcount8: number of ones in an 8-bit word, adder tree
module popcount8 (
  input  logic [7:0] in,
  output logic [3:0] count
);
  logic [1:0] p0, p1, p2, p3;  // pairs
  logic [2:0] q0, q1;          // nibbles

  always_comb begin
    p0 = {1'b0, in[0]} + {1'b0, in[1]};
    p1 = {1'b0, in[2]} + {1'b0, in[3]};
    p2 = {1'b0, in[4]} + {1'b0, in[5]};
    p3 = {1'b0, in[6]} + {1'b0, in[7]};
    q0 = {1'b0, p0} + {1'b0, p1};
    q1 = {1'b0, p2} + {1'b0, p3};
    count = {1'b0, q0} + {1'b0, q1};
  end
endmodule

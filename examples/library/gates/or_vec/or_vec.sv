// or_vec: bitwise OR of two WIDTH-bit vectors
module or_vec #(
  parameter int WIDTH = 8
) (
  input  logic [WIDTH-1:0] a,
  input  logic [WIDTH-1:0] b,
  output logic [WIDTH-1:0] y
);
  always_comb begin
    y = a | b;
  end
endmodule

// abs8: absolute value of a signed two's-complement WIDTH-bit (default 8) number
// The result is unsigned, so |-128| = 128 is represented exactly.
module abs8 #(
  parameter int WIDTH = 8
) (
  input  logic [WIDTH-1:0] a,   // signed two's complement
  output logic [WIDTH-1:0] y    // unsigned magnitude
);
  always_comb begin
    if (a[WIDTH-1])
      y = ~a + 1'b1;   // negate negative values
    else
      y = a;
  end
endmodule

// multiplier8_signed: signed two's-complement WIDTH x WIDTH (default 8x8) multiplier
module multiplier8_signed #(
  parameter int WIDTH = 8
) (
  input  logic signed [WIDTH-1:0]   a,
  input  logic signed [WIDTH-1:0]   b,
  output logic signed [2*WIDTH-1:0] product
);
  logic signed [2*WIDTH-1:0] a_ext, b_ext;

  always_comb begin
    // sign-extend both operands to the product width, then multiply
    a_ext   = {{WIDTH{a[WIDTH-1]}}, a};
    b_ext   = {{WIDTH{b[WIDTH-1]}}, b};
    product = a_ext * b_ext;
  end
endmodule

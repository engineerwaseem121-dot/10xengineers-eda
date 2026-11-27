// subtractor8: WIDTH-bit (default 8) unsigned subtractor, diff = a - b with borrow
module subtractor8 #(
  parameter int WIDTH = 8
) (
  input  logic [WIDTH-1:0] a,
  input  logic [WIDTH-1:0] b,
  output logic [WIDTH-1:0] diff,
  output logic             borrow
);
  logic [WIDTH:0] wide;

  always_comb begin
    // zero-extend both operands; bit WIDTH of the result is the borrow
    wide   = {1'b0, a} - {1'b0, b};
    diff   = wide[WIDTH-1:0];
    borrow = wide[WIDTH];
  end
endmodule

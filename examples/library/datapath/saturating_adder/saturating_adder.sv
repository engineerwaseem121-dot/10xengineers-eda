// saturating_adder: unsigned 8-bit add that clamps at 255 instead of wrapping
module saturating_adder (
  input  logic [7:0] a,
  input  logic [7:0] b,
  output logic [7:0] sum,
  output logic       sat
);
  logic [8:0] full;

  always_comb begin
    full = {1'b0, a} + {1'b0, b};
    sat  = full[8];
    sum  = full[8] ? 8'hFF : full[7:0];
  end
endmodule

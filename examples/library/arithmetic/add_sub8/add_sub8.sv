// add_sub8: WIDTH-bit (default 8) adder/subtractor
//   mode = 0 : result = a + b
//   mode = 1 : result = a - b  (computed as a + ~b + 1)
module add_sub8 #(
  parameter int WIDTH = 8
) (
  input  logic [WIDTH-1:0] a,
  input  logic [WIDTH-1:0] b,
  input  logic             mode,
  output logic [WIDTH-1:0] result,
  output logic             carry_out,
  output logic             overflow
);
  logic [WIDTH-1:0] b_eff;
  logic [WIDTH:0]   wide;

  always_comb begin
    b_eff     = b ^ {WIDTH{mode}};               // invert b when subtracting
    wide      = {1'b0, a} + {1'b0, b_eff} + {{WIDTH{1'b0}}, mode};
    result    = wide[WIDTH-1:0];
    carry_out = wide[WIDTH];
    // signed overflow: operands (as seen by the adder) share a sign that the result does not
    overflow  = (a[WIDTH-1] == b_eff[WIDTH-1]) && (result[WIDTH-1] != a[WIDTH-1]);
  end
endmodule

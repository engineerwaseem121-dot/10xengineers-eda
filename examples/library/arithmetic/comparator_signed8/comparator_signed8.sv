// comparator_signed8: signed two's-complement WIDTH-bit (default 8) comparator
module comparator_signed8 #(
  parameter int WIDTH = 8
) (
  input  logic signed [WIDTH-1:0] a,
  input  logic signed [WIDTH-1:0] b,
  output logic                    eq,
  output logic                    lt,
  output logic                    gt
);
  always_comb begin
    eq = (a == b);
    lt = (a <  b);   // both operands signed: signed compare
    gt = (a >  b);
  end
endmodule

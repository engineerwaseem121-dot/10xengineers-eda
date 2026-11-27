// comparator4: unsigned WIDTH-bit (default 4) magnitude comparator
module comparator4 #(
  parameter int WIDTH = 4
) (
  input  logic [WIDTH-1:0] a,
  input  logic [WIDTH-1:0] b,
  output logic             eq,
  output logic             lt,
  output logic             gt
);
  always_comb begin
    eq = (a == b);
    lt = (a <  b);
    gt = (a >  b);
  end
endmodule

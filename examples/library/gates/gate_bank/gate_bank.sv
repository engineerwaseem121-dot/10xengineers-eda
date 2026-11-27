// gate_bank: all six 2-input bitwise gates applied to two WIDTH-bit vectors
module gate_bank #(
  parameter int WIDTH = 8
) (
  input  logic [WIDTH-1:0] a,
  input  logic [WIDTH-1:0] b,
  output logic [WIDTH-1:0] and_o,
  output logic [WIDTH-1:0] or_o,
  output logic [WIDTH-1:0] xor_o,
  output logic [WIDTH-1:0] nand_o,
  output logic [WIDTH-1:0] nor_o,
  output logic [WIDTH-1:0] xnor_o
);
  always_comb begin
    and_o  = a & b;
    or_o   = a | b;
    xor_o  = a ^ b;
    nand_o = ~(a & b);
    nor_o  = ~(a | b);
    xnor_o = ~(a ^ b);
  end
endmodule

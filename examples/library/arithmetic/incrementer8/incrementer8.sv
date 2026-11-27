// incrementer8: WIDTH-bit (default 8) incrementer, {carry, y} = a + 1
module incrementer8 #(
  parameter int WIDTH = 8
) (
  input  logic [WIDTH-1:0] a,
  output logic [WIDTH-1:0] y,
  output logic             carry
);
  assign {carry, y} = {1'b0, a} + 1'b1;
endmodule

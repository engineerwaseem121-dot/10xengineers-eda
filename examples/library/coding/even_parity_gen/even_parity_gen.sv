// even_parity_gen: parity bit that makes the total number of ones even
module even_parity_gen (
  input  logic [7:0] data,
  output logic       parity
);
  assign parity = ^data;
endmodule

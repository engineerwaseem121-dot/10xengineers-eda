// full_subtractor: computes a - b - bin for single bits
module full_subtractor (
  input  logic a,
  input  logic b,
  input  logic bin,
  output logic diff,
  output logic bout
);
  logic axb;
  assign axb  = a ^ b;
  assign diff = axb ^ bin;
  assign bout = (~a & b) | (~axb & bin);
endmodule

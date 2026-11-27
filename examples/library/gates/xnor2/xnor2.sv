// xnor2: 2-input XNOR gate
module xnor2 (
  input  logic a,
  input  logic b,
  output logic y
);
  assign y = ~(a ^ b);
endmodule

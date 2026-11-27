// xor2: 2-input XOR gate
module xor2 (
  input  logic a,
  input  logic b,
  output logic y
);
  assign y = a ^ b;
endmodule

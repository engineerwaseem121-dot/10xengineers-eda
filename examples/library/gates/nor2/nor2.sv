// nor2: 2-input NOR gate
module nor2 (
  input  logic a,
  input  logic b,
  output logic y
);
  assign y = ~(a | b);
endmodule

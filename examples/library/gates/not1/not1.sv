// not1: single-input NOT (inverter) gate
module not1 (
  input  logic a,
  output logic y
);
  assign y = ~a;
endmodule

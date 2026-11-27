// half_adder: adds two 1-bit operands
module half_adder (
  input  logic a,
  input  logic b,
  output logic sum,
  output logic carry
);
  assign sum   = a ^ b;
  assign carry = a & b;
endmodule

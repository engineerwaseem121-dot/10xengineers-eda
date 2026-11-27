// full_adder: adds two 1-bit operands and a carry in
module full_adder (
  input  logic a,
  input  logic b,
  input  logic cin,
  output logic sum,
  output logic cout
);
  logic axb;
  assign axb  = a ^ b;
  assign sum  = axb ^ cin;
  assign cout = (a & b) | (axb & cin);
endmodule

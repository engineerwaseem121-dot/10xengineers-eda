// nand2: 2-input NAND gate
module nand2 (
  input  logic a,
  input  logic b,
  output logic y
);
  assign y = ~(a & b);
endmodule

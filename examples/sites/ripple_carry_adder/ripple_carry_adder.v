// Ripple-carry adder, SIZE bits, built from 1-bit full adders.
// Original implementation of the design described at
//   https://vlsiverify.com/verilog/verilog-codes/ripple-carry-adder/
// (same interface: Cout is the carry out of every stage; Cout[SIZE-1] is the adder's carry out).
module full_adder (
  input  a, b, cin,
  output sum, cout
);
  assign sum  = a ^ b ^ cin;
  assign cout = (a & b) | (cin & (a ^ b));
endmodule

module ripple_carry_adder #(
  parameter SIZE = 4
) (
  input  [SIZE-1:0] A,
  input  [SIZE-1:0] B,
  input             Cin,
  output [SIZE-1:0] S,
  output [SIZE-1:0] Cout
);
  genvar i;
  generate
    for (i = 0; i < SIZE; i = i + 1) begin : stage
      full_adder fa (
        .a   (A[i]),
        .b   (B[i]),
        .cin (i == 0 ? Cin : Cout[i-1]),
        .sum (S[i]),
        .cout(Cout[i])
      );
    end
  endgenerate
endmodule

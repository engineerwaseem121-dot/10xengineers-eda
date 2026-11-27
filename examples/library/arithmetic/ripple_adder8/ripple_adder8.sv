// ripple_adder8: WIDTH-bit (default 8) ripple-carry adder made of full_adder cells
module ripple_adder8 #(
  parameter int WIDTH = 8
) (
  input  logic [WIDTH-1:0] a,
  input  logic [WIDTH-1:0] b,
  input  logic             cin,
  output logic [WIDTH-1:0] sum,
  output logic             cout
);
  logic [WIDTH:0] c;   // c[i] is the carry into bit i

  assign c[0] = cin;

  genvar i;
  generate
    for (i = 0; i < WIDTH; i++) begin : g_bit
      full_adder u_fa (
        .a   (a[i]),
        .b   (b[i]),
        .cin (c[i]),
        .sum (sum[i]),
        .cout(c[i+1])
      );
    end
  endgenerate

  assign cout = c[WIDTH];
endmodule

// 1-bit full adder cell used by the ripple chain
module full_adder (
  input  logic a,
  input  logic b,
  input  logic cin,
  output logic sum,
  output logic cout
);
  assign sum  = a ^ b ^ cin;
  assign cout = (a & b) | (a & cin) | (b & cin);
endmodule

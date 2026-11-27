// cla_adder4: 4-bit carry-lookahead adder
module cla_adder4 (
  input  logic [3:0] a,
  input  logic [3:0] b,
  input  logic       cin,
  output logic [3:0] sum,
  output logic       cout
);
  logic [3:0] g;   // generate
  logic [3:0] p;   // propagate
  logic [4:0] c;   // carry into each bit, c[4] = carry out

  always_comb begin
    g = a & b;
    p = a ^ b;

    c[0] = cin;
    c[1] = g[0] | (p[0] & c[0]);
    c[2] = g[1] | (p[1] & g[0]) | (p[1] & p[0] & c[0]);
    c[3] = g[2] | (p[2] & g[1]) | (p[2] & p[1] & g[0]) | (p[2] & p[1] & p[0] & c[0]);
    c[4] = g[3] | (p[3] & g[2]) | (p[3] & p[2] & g[1]) | (p[3] & p[2] & p[1] & g[0])
               | (p[3] & p[2] & p[1] & p[0] & c[0]);

    sum  = p ^ c[3:0];
    cout = c[4];
  end
endmodule

// lfsr8: 8-bit Fibonacci LFSR, taps 8,6,5,4 (x^8 + x^6 + x^5 + x^4 + 1), seed 8'h01
module lfsr8 (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       en,
  output logic [7:0] q
);
  logic fb;
  // tap n corresponds to bit n-1
  assign fb = q[7] ^ q[5] ^ q[4] ^ q[3];

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)  q <= 8'h01;
    else if (en) q <= {q[6:0], fb};
  end
endmodule

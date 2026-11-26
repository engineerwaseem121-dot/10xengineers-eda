// Counter 0..N that wraps from N back to 0, with enable and terminal-count flag.
// N = 0 is legal: the count stays 0 and tc stays 1.
module counter_0_to_n #(
  parameter int N = 9,
  parameter int W = 4        // must hold N
) (
  input  logic         clk,
  input  logic         rst_n,
  input  logic         en,
  output logic [W-1:0] count,
  output logic         tc
);
  always_ff @(posedge clk or negedge rst_n)
    if (!rst_n)            count <= '0;
    else if (en)           count <= (count == W'(N)) ? '0 : count + 1'b1;
  assign tc = (count == W'(N));
endmodule

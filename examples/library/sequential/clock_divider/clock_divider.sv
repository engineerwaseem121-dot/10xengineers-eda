// clock_divider: divides clk by DIV (even) with 50% duty cycle
module clock_divider #(
  parameter int DIV = 4   // must be even and >= 2
) (
  input  logic clk,
  input  logic rst_n,
  output logic clk_out
);
  localparam int HALF = DIV / 2;
  localparam int CW   = (HALF > 1) ? $clog2(HALF) : 1;
  logic [CW-1:0] cnt;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      cnt     <= '0;
      clk_out <= 1'b0;
    end else if (cnt == CW'(HALF - 1)) begin
      cnt     <= '0;
      clk_out <= ~clk_out;
    end else begin
      cnt     <= cnt + 1'b1;
    end
  end
endmodule

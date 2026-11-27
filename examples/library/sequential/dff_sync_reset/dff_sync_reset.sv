// dff_sync_reset: D flip-flop with synchronous active-high reset
module dff_sync_reset (
  input  logic clk,
  input  logic rst,
  input  logic d,
  output logic q
);
  always_ff @(posedge clk) begin
    if (rst) q <= 1'b0;
    else     q <= d;
  end
endmodule

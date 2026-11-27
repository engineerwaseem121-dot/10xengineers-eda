// sipo_shift: 8-bit serial-in parallel-out shift register
module sipo_shift (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       sin,
  output logic [7:0] pout
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) pout <= 8'h00;
    else        pout <= {pout[6:0], sin};
  end
endmodule

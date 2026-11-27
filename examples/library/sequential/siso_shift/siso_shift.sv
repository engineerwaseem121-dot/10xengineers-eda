// siso_shift: 8-stage serial-in serial-out shift register
module siso_shift (
  input  logic clk,
  input  logic rst_n,
  input  logic sin,
  output logic sout
);
  logic [7:0] sr;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) sr <= 8'h00;
    else        sr <= {sr[6:0], sin};
  end
  assign sout = sr[7];
endmodule

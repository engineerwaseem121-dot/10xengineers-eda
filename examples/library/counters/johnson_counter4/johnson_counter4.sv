// johnson_counter4: 4-bit Johnson (twisted ring) counter, 8 states
module johnson_counter4 (
  input  logic       clk,
  input  logic       rst_n,
  output logic [3:0] q
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) q <= 4'b0000;
    else        q <= {q[2:0], ~q[3]};
  end
endmodule

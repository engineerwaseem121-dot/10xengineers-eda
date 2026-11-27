// ring_counter4: 4-bit one-hot ring counter, reset value 0001, rotates left
module ring_counter4 (
  input  logic       clk,
  input  logic       rst_n,
  output logic [3:0] q
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) q <= 4'b0001;
    else        q <= {q[2:0], q[3]};
  end
endmodule

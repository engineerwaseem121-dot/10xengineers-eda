// pwm_gen: 8-bit PWM generator, period 256 clock cycles
module pwm_gen (
  input  logic       clk,
  input  logic       rst_n,
  input  logic [7:0] duty,   // high time in cycles per 256-cycle period
  output logic       pwm
);
  logic [7:0] cnt;
  logic [7:0] duty_q;        // duty value used in the current period

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      cnt    <= 8'd0;
      duty_q <= 8'd0;
    end else begin
      cnt <= cnt + 8'd1;
      // take the new duty only at the period boundary (no glitches mid-period)
      if (cnt == 8'hFF) duty_q <= duty;
    end
  end

  assign pwm = (cnt < duty_q);
endmodule

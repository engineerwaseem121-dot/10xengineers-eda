// updown_counter8: 8-bit up/down counter with enable, wraps both ways
module updown_counter8 (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       en,
  input  logic       up,
  output logic [7:0] count
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) count <= 8'd0;
    else if (en) begin
      if (up) count <= count + 8'd1;
      else    count <= count - 8'd1;
    end
  end
endmodule

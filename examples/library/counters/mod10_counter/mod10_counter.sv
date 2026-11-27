// mod10_counter: synchronous decade counter 0..9 with enable
module mod10_counter (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       en,
  output logic [3:0] count
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) count <= 4'd0;
    else if (en) begin
      if (count >= 4'd9) count <= 4'd0;
      else               count <= count + 4'd1;
    end
  end
endmodule

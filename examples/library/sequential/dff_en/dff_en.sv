// dff_en: D flip-flop with clock enable and asynchronous active-low reset
module dff_en (
  input  logic clk,
  input  logic rst_n,
  input  logic en,
  input  logic d,
  output logic q
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)  q <= 1'b0;
    else if (en) q <= d;
  end
endmodule

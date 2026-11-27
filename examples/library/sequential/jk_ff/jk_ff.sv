// jk_ff: JK flip-flop with asynchronous active-low reset
module jk_ff (
  input  logic clk,
  input  logic rst_n,
  input  logic j,
  input  logic k,
  output logic q
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) q <= 1'b0;
    else begin
      case ({j, k})
        2'b00:   q <= q;     // hold
        2'b01:   q <= 1'b0;  // reset
        2'b10:   q <= 1'b1;  // set
        default: q <= ~q;    // toggle
      endcase
    end
  end
endmodule

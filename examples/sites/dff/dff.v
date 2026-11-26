// D flip-flop: rising-edge capture, asynchronous active-low reset.
// Original implementation of the design described at
//   https://lab.chipverify.com/examples/d-flip-flop-testbench
module dff (
  input      d,
  input      rstn,
  input      clk,
  output reg q
);
  always @(posedge clk or negedge rstn)
    if (!rstn) q <= 1'b0;
    else       q <= d;
endmodule

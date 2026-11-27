// edge_detector: registered rising/falling edge detector, one-cycle pulses
module edge_detector (
  input  logic clk,
  input  logic rst_n,
  input  logic sig,
  output logic rise,
  output logic fall
);
  logic sig_d;   // value of sig at the previous clock edge
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      sig_d <= 1'b0;
      rise  <= 1'b0;
      fall  <= 1'b0;
    end else begin
      sig_d <= sig;
      rise  <= sig & ~sig_d;
      fall  <= ~sig & sig_d;
    end
  end
endmodule

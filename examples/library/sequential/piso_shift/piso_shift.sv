// piso_shift: 8-bit parallel-in serial-out shift register, MSB first
module piso_shift (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       load,
  input  logic [7:0] pin,
  output logic       sout
);
  logic [7:0] sr;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)    sr <= 8'h00;
    else if (load) sr <= pin;
    else           sr <= {sr[6:0], 1'b0};
  end
  assign sout = sr[7];
endmodule

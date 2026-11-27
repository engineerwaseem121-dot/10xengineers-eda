// register8_load: 8-bit register with synchronous load enable
module register8_load (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       load,
  input  logic [7:0] din,
  output logic [7:0] dout
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)    dout <= 8'h00;
    else if (load) dout <= din;
  end
endmodule

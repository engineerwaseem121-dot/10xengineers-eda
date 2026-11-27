// mac_unit: signed 8x8 multiply-accumulate into a 20-bit accumulator
module mac_unit (
  input  logic               clk,
  input  logic               rst_n,
  input  logic               clear,
  input  logic               en,
  input  logic signed [7:0]  a,
  input  logic signed [7:0]  b,
  output logic signed [19:0] acc
);
  logic signed [15:0] prod;

  assign prod = a * b;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      acc <= '0;
    end else if (clear) begin
      acc <= '0;
    end else if (en) begin
      acc <= acc + {{4{prod[15]}}, prod};  // sign-extend, wraps modulo 2^20
    end
  end
endmodule

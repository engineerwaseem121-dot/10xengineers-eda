// mux8: 8-to-1 multiplexer; the eight WIDTH-bit inputs are packed in in_data
//   input k occupies in_data[k*WIDTH +: WIDTH]
module mux8 #(
  parameter int WIDTH = 8
) (
  input  logic [8*WIDTH-1:0] in_data,
  input  logic [2:0]         sel,
  output logic [WIDTH-1:0]   y
);
  always_comb begin
    y = in_data[sel*WIDTH +: WIDTH];
  end
endmodule

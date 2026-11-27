// mux4: 4-to-1 multiplexer with WIDTH-bit data inputs d0..d3
module mux4 #(
  parameter int WIDTH = 8
) (
  input  logic [WIDTH-1:0] d0,
  input  logic [WIDTH-1:0] d1,
  input  logic [WIDTH-1:0] d2,
  input  logic [WIDTH-1:0] d3,
  input  logic [1:0]       sel,
  output logic [WIDTH-1:0] y
);
  always_comb begin
    case (sel)
      2'd0:    y = d0;
      2'd1:    y = d1;
      2'd2:    y = d2;
      default: y = d3;
    endcase
  end
endmodule

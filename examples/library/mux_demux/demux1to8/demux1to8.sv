// demux1to8: routes din to one of eight WIDTH-bit slots of dout; other slots are 0
//   slot k occupies dout[k*WIDTH +: WIDTH]
module demux1to8 #(
  parameter int WIDTH = 8
) (
  input  logic [WIDTH-1:0]   din,
  input  logic [2:0]         sel,
  output logic [8*WIDTH-1:0] dout
);
  always_comb begin
    dout = '0;
    dout[sel*WIDTH +: WIDTH] = din;
  end
endmodule

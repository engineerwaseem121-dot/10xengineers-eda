// demux1to4: routes din to one of four outputs; unselected outputs are 0
module demux1to4 #(
  parameter int WIDTH = 8
) (
  input  logic [WIDTH-1:0] din,
  input  logic [1:0]       sel,
  output logic [WIDTH-1:0] y0,
  output logic [WIDTH-1:0] y1,
  output logic [WIDTH-1:0] y2,
  output logic [WIDTH-1:0] y3
);
  always_comb begin
    y0 = '0;
    y1 = '0;
    y2 = '0;
    y3 = '0;
    case (sel)
      2'd0:    y0 = din;
      2'd1:    y1 = din;
      2'd2:    y2 = din;
      default: y3 = din;
    endcase
  end
endmodule

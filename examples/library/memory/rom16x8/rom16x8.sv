// rom16x8: 16 x 8 synchronous ROM, contents = addr * addr (table of squares)
module rom16x8 (
  input  logic       clk,
  input  logic       rst_n,
  input  logic [3:0] addr,
  output logic [7:0] dout
);
  logic [7:0] data;

  always_comb begin
    case (addr)
      4'd0:    data = 8'd0;
      4'd1:    data = 8'd1;
      4'd2:    data = 8'd4;
      4'd3:    data = 8'd9;
      4'd4:    data = 8'd16;
      4'd5:    data = 8'd25;
      4'd6:    data = 8'd36;
      4'd7:    data = 8'd49;
      4'd8:    data = 8'd64;
      4'd9:    data = 8'd81;
      4'd10:   data = 8'd100;
      4'd11:   data = 8'd121;
      4'd12:   data = 8'd144;
      4'd13:   data = 8'd169;
      4'd14:   data = 8'd196;
      default: data = 8'd225;
    endcase
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) dout <= 8'h00;
    else        dout <= data;
  end
endmodule

// universal_shift4: 4-bit universal shift register (hold / shift left / shift right / load)
module universal_shift4 (
  input  logic       clk,
  input  logic       rst_n,
  input  logic [1:0] mode,   // 00 hold, 01 shift left, 10 shift right, 11 parallel load
  input  logic       sl_in,  // serial input entering bit 0 on shift left
  input  logic       sr_in,  // serial input entering bit 3 on shift right
  input  logic [3:0] din,
  output logic [3:0] q
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) q <= 4'h0;
    else begin
      case (mode)
        2'b00:   q <= q;
        2'b01:   q <= {q[2:0], sl_in};
        2'b10:   q <= {sr_in, q[3:1]};
        default: q <= din;
      endcase
    end
  end
endmodule

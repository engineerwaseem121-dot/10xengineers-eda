// decoder3to8_en: binary in[2:0] -> one-hot out[7:0], gated by en
module decoder3to8_en (
  input  logic       en,
  input  logic [2:0] in,
  output logic [7:0] out
);
  always_comb begin
    out = 8'b0;
    if (en) out[in] = 1'b1;
  end
endmodule

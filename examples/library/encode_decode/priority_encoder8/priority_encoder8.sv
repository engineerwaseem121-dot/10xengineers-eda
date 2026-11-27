// priority_encoder8: highest set bit of in[7:0] -> out[2:0], valid
module priority_encoder8 (
  input  logic [7:0] in,
  output logic [2:0] out,
  output logic       valid
);
  always_comb begin
    valid = |in;
    out   = 3'd0;
    // later iterations override earlier ones, so the highest set bit wins
    for (int i = 0; i < 8; i++) begin
      if (in[i]) out = i[2:0];
    end
  end
endmodule

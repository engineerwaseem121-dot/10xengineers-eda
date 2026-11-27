// priority_encoder4: highest set bit of in[3:0] -> out[1:0], valid
module priority_encoder4 (
  input  logic [3:0] in,
  output logic [1:0] out,
  output logic       valid
);
  always_comb begin
    valid = |in;
    if (in[3])      out = 2'd3;
    else if (in[2]) out = 2'd2;
    else if (in[1]) out = 2'd1;
    else            out = 2'd0;
  end
endmodule

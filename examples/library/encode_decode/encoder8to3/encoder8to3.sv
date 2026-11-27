// encoder8to3: one-hot in[7:0] -> binary out[2:0]
module encoder8to3 (
  input  logic [7:0] in,
  output logic [2:0] out
);
  always_comb begin
    out[0] = in[1] | in[3] | in[5] | in[7];
    out[1] = in[2] | in[3] | in[6] | in[7];
    out[2] = in[4] | in[5] | in[6] | in[7];
  end
endmodule

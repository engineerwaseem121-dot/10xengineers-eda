// encoder4to2: one-hot in[3:0] -> binary out[1:0]
module encoder4to2 (
  input  logic [3:0] in,
  output logic [1:0] out
);
  always_comb begin
    out[0] = in[1] | in[3];
    out[1] = in[2] | in[3];
  end
endmodule

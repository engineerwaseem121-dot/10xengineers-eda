// decoder2to4: binary in[1:0] -> one-hot out[3:0]
module decoder2to4 (
  input  logic [1:0] in,
  output logic [3:0] out
);
  always_comb begin
    case (in)
      2'd0: out = 4'b0001;
      2'd1: out = 4'b0010;
      2'd2: out = 4'b0100;
      default: out = 4'b1000;
    endcase
  end
endmodule

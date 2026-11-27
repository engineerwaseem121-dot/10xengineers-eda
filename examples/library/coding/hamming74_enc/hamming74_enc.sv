// hamming74_enc: Hamming(7,4) encoder
// code[k-1] holds codeword position k (k = 1..7):
//   pos 1 = p1, pos 2 = p2, pos 3 = d0, pos 4 = p4, pos 5 = d1, pos 6 = d2, pos 7 = d3
module hamming74_enc (
  input  logic [3:0] data,
  output logic [6:0] code
);
  logic p1, p2, p4;

  always_comb begin
    p1 = data[0] ^ data[1] ^ data[3];   // covers positions 3,5,7
    p2 = data[0] ^ data[2] ^ data[3];   // covers positions 3,6,7
    p4 = data[1] ^ data[2] ^ data[3];   // covers positions 5,6,7
    code = {data[3], data[2], data[1], p4, data[0], p2, p1};
  end
endmodule

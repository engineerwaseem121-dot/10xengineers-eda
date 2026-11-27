// hamming74_dec: Hamming(7,4) decoder with single-bit error correction
// code[k-1] holds codeword position k (k = 1..7):
//   pos 1 = p1, pos 2 = p2, pos 3 = d0, pos 4 = p4, pos 5 = d1, pos 6 = d2, pos 7 = d3
module hamming74_dec (
  input  logic [6:0] code,
  output logic [3:0] data,
  output logic       corrected
);
  logic [2:0] syndrome;
  logic [6:0] fixed;

  always_comb begin
    syndrome[0] = code[0] ^ code[2] ^ code[4] ^ code[6];  // positions 1,3,5,7
    syndrome[1] = code[1] ^ code[2] ^ code[5] ^ code[6];  // positions 2,3,6,7
    syndrome[2] = code[3] ^ code[4] ^ code[5] ^ code[6];  // positions 4,5,6,7

    fixed = code;
    if (syndrome != 3'd0) fixed[syndrome - 3'd1] = ~code[syndrome - 3'd1];

    corrected = (syndrome != 3'd0);
    data      = {fixed[6], fixed[5], fixed[4], fixed[2]};
  end
endmodule

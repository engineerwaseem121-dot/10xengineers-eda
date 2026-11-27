// crc8_comb: CRC-8 (poly x^8+x^2+x+1 = 0x07, init 0x00, no reflection,
// no final XOR) of one data byte, computed in a single combinational step
module crc8_comb (
  input  logic [7:0] data,
  output logic [7:0] crc
);
  localparam logic [7:0] POLY = 8'h07;

  logic [7:0] r;

  always_comb begin
    r = data;  // init 0x00 XOR data byte
    for (int i = 0; i < 8; i++) begin
      if (r[7]) r = (r << 1) ^ POLY;
      else      r = r << 1;
    end
    crc = r;
  end
endmodule

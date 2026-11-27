// crc16_ccitt_serial: bit-serial CRC-16-CCITT (poly 0x1021, init 0xFFFF),
// one data bit per enabled clock, MSB of each byte first
module crc16_ccitt_serial (
  input  logic        clk,
  input  logic        rst_n,
  input  logic        init,
  input  logic        en,
  input  logic        din,
  output logic [15:0] crc
);
  localparam logic [15:0] POLY = 16'h1021;
  localparam logic [15:0] SEED = 16'hFFFF;

  logic fb;
  assign fb = crc[15] ^ din;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      crc <= SEED;
    end else if (init) begin
      crc <= SEED;
    end else if (en) begin
      crc <= {crc[14:0], 1'b0} ^ (fb ? POLY : 16'h0000);
    end
  end
endmodule

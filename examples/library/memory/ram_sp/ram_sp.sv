// ram_sp: single-port synchronous RAM, registered read, read-during-write returns old data
module ram_sp #(
  parameter int DEPTH = 16,
  parameter int WIDTH = 8,
  parameter int AW    = $clog2(DEPTH)
) (
  input  logic             clk,
  input  logic             rst_n,
  input  logic [AW-1:0]    addr,
  input  logic             we,
  input  logic [WIDTH-1:0] din,
  output logic [WIDTH-1:0] dout
);
  logic [WIDTH-1:0] mem [0:DEPTH-1];

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      for (int i = 0; i < DEPTH; i++) mem[i] <= '0;
      dout <= '0;
    end else begin
      dout <= mem[addr];               // old contents, even when writing the same address
      if (we) mem[addr] <= din;
    end
  end
endmodule

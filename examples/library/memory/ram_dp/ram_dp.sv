// ram_dp: simple dual-port RAM (one write port, one registered read port, same clock)
module ram_dp #(
  parameter int DEPTH = 16,
  parameter int WIDTH = 8,
  parameter int AW    = $clog2(DEPTH)
) (
  input  logic             clk,
  input  logic             rst_n,
  // write port
  input  logic             we,
  input  logic [AW-1:0]    waddr,
  input  logic [WIDTH-1:0] wdata,
  // read port
  input  logic [AW-1:0]    raddr,
  output logic [WIDTH-1:0] rdata
);
  logic [WIDTH-1:0] mem [0:DEPTH-1];

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      for (int i = 0; i < DEPTH; i++) mem[i] <= '0;
      rdata <= '0;
    end else begin
      rdata <= mem[raddr];             // old data when raddr == waddr in the same cycle
      if (we) mem[waddr] <= wdata;
    end
  end
endmodule

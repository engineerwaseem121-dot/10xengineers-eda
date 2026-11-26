// Small synchronous memory: 2^ADDR_WIDTH words of DATA_WIDTH bits.
// Original implementation of the memory model specified at
//   https://verificationguide.com/systemverilog-examples/systemverilog-testbench-example-memory_m/
// - write: addr, wr_en and wdata in the same cycle
// - read:  addr and rd_en in the same cycle; rdata is valid on the next clock
// - reset: every location returns to RESET_VALUE ('hFF by default)
// Reset is synchronous and active-high (the page leaves polarity and timing open).
// A read and a write to the same address in the same cycle returns the OLD data.
module memory #(
  parameter int ADDR_WIDTH  = 2,
  parameter int DATA_WIDTH  = 8,
  parameter logic [DATA_WIDTH-1:0] RESET_VALUE = 8'hFF
) (
  input  logic                  clk,
  input  logic                  reset,
  input  logic [ADDR_WIDTH-1:0] addr,
  input  logic                  wr_en,
  input  logic                  rd_en,
  input  logic [DATA_WIDTH-1:0] wdata,
  output logic [DATA_WIDTH-1:0] rdata
);
  localparam int DEPTH = 1 << ADDR_WIDTH;
  logic [DATA_WIDTH-1:0] mem [DEPTH];

  always_ff @(posedge clk) begin
    if (reset) begin
      for (int i = 0; i < DEPTH; i++) mem[i] <= RESET_VALUE;
      rdata <= RESET_VALUE;
    end else begin
      if (rd_en) rdata <= mem[addr];
      if (wr_en) mem[addr] <= wdata;
    end
  end
endmodule

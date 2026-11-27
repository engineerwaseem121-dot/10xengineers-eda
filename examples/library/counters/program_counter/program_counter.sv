// program_counter: 32-bit PC with load, relative branch and +4 increment
module program_counter #(
  parameter logic [31:0] RESET_VECTOR = 32'h0000_0000
) (
  input  logic        clk,
  input  logic        rst_n,
  input  logic        en,
  input  logic        load,
  input  logic [31:0] load_addr,
  input  logic        branch,
  input  logic [31:0] offset,   // signed two's-complement byte offset
  output logic [31:0] pc
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)      pc <= RESET_VECTOR;
    else if (load)   pc <= load_addr;
    else if (branch) pc <= pc + offset;
    else if (en)     pc <= pc + 32'd4;
  end
endmodule

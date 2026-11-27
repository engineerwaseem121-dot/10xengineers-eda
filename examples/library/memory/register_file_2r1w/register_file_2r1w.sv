// register_file_2r1w: 8 x 8-bit register file, 2 combinational read ports, 1 write port, x0 hard-wired to 0
module register_file_2r1w (
  input  logic       clk,
  input  logic       rst_n,
  input  logic [2:0] ra1,
  input  logic [2:0] ra2,
  output logic [7:0] rd1,
  output logic [7:0] rd2,
  input  logic       we,
  input  logic [2:0] wa,
  input  logic [7:0] wd
);
  logic [7:0] regs [1:7];   // register 0 is not stored

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      for (int i = 1; i < 8; i++) regs[i] <= 8'h00;
    end else if (we && (wa != 3'd0)) begin
      regs[wa] <= wd;
    end
  end

  assign rd1 = (ra1 == 3'd0) ? 8'h00 : regs[ra1];
  assign rd2 = (ra2 == 3'd0) ? 8'h00 : regs[ra2];
endmodule

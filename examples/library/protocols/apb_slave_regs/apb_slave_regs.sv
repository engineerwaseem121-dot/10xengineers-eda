// apb_slave_regs: APB slave with four 32-bit read/write registers at 0x0, 0x4, 0x8, 0xC
module apb_slave_regs (
  input  logic        pclk,
  input  logic        presetn,
  input  logic        psel,
  input  logic        penable,
  input  logic        pwrite,
  input  logic [7:0]  paddr,
  input  logic [31:0] pwdata,
  output logic [31:0] prdata,
  output logic        pready,
  output logic        pslverr
);
  logic [31:0] reg0, reg1, reg2, reg3;
  logic        mapped;
  logic        wr_en;
  logic [1:0]  sel;

  // only word-aligned offsets 0x00..0x0C are decoded
  assign mapped = (paddr[7:4] == 4'h0) && (paddr[1:0] == 2'b00);
  assign sel    = paddr[3:2];
  assign wr_en  = psel && penable && pwrite && mapped;

  always_ff @(posedge pclk or negedge presetn) begin
    if (!presetn) begin
      reg0 <= '0;
      reg1 <= '0;
      reg2 <= '0;
      reg3 <= '0;
    end else if (wr_en) begin
      case (sel)
        2'd0: reg0 <= pwdata;
        2'd1: reg1 <= pwdata;
        2'd2: reg2 <= pwdata;
        default: reg3 <= pwdata;
      endcase
    end
  end

  always_comb begin
    prdata = '0;
    if (psel && !pwrite && mapped) begin
      case (sel)
        2'd0: prdata = reg0;
        2'd1: prdata = reg1;
        2'd2: prdata = reg2;
        default: prdata = reg3;
      endcase
    end
  end

  assign pready  = 1'b1;                         // no wait states
  assign pslverr = psel && penable && !mapped;   // error only in the access phase
endmodule

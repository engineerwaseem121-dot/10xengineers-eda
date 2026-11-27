// wishbone_slave_regs: Wishbone B4 classic slave with four 32-bit registers
module wishbone_slave_regs (
  input  logic        clk_i,
  input  logic        rst_i,    // synchronous, active high (Wishbone convention)
  input  logic        cyc_i,
  input  logic        stb_i,
  input  logic        we_i,
  input  logic [1:0]  adr_i,    // word address of the register
  input  logic [31:0] dat_i,
  input  logic [3:0]  sel_i,    // byte selects
  output logic [31:0] dat_o,
  output logic        ack_o
);
  logic [31:0] reg0, reg1, reg2, reg3;
  logic [31:0] cur, merged;
  logic        req;

  // a new request: strobe inside a cycle, not yet acknowledged
  assign req = cyc_i && stb_i && !ack_o;

  always_comb begin
    case (adr_i)
      2'd0:    cur = reg0;
      2'd1:    cur = reg1;
      2'd2:    cur = reg2;
      default: cur = reg3;
    endcase
    for (int b = 0; b < 4; b++)
      merged[8*b +: 8] = sel_i[b] ? dat_i[8*b +: 8] : cur[8*b +: 8];
  end

  always_ff @(posedge clk_i) begin
    if (rst_i) begin
      reg0  <= '0;
      reg1  <= '0;
      reg2  <= '0;
      reg3  <= '0;
      dat_o <= '0;
      ack_o <= 1'b0;
    end else begin
      ack_o <= req;
      if (req) begin
        if (we_i) begin
          case (adr_i)
            2'd0:    reg0 <= merged;
            2'd1:    reg1 <= merged;
            2'd2:    reg2 <= merged;
            default: reg3 <= merged;
          endcase
        end else begin
          dat_o <= cur;
        end
      end
    end
  end
endmodule

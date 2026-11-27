// axi4lite_slave_regs: AXI4-Lite slave with four 32-bit registers at 0x0, 0x4, 0x8, 0xC
module axi4lite_slave_regs #(
  parameter int ADDR_W = 8
) (
  input  logic              aclk,
  input  logic              aresetn,
  // write address channel
  input  logic [ADDR_W-1:0] awaddr,
  input  logic [2:0]        awprot,
  input  logic              awvalid,
  output logic              awready,
  // write data channel
  input  logic [31:0]       wdata,
  input  logic [3:0]        wstrb,
  input  logic              wvalid,
  output logic              wready,
  // write response channel
  output logic [1:0]        bresp,
  output logic              bvalid,
  input  logic              bready,
  // read address channel
  input  logic [ADDR_W-1:0] araddr,
  input  logic [2:0]        arprot,
  input  logic              arvalid,
  output logic              arready,
  // read data channel
  output logic [31:0]       rdata,
  output logic [1:0]        rresp,
  output logic              rvalid,
  input  logic              rready
);
  localparam logic [1:0] RESP_OKAY   = 2'b00;
  localparam logic [1:0] RESP_SLVERR = 2'b10;

  logic [31:0]       reg0, reg1, reg2, reg3;
  // write address / data holding registers (AW and W may arrive in any order)
  logic              aw_full, w_full;
  logic [ADDR_W-1:0] aw_addr_q;
  logic [31:0]       w_data_q;
  logic [3:0]        w_strb_q;
  logic              do_write;
  logic              wr_mapped, rd_mapped;
  logic [1:0]        wr_sel, rd_sel;
  logic [31:0]       wr_old, wr_new, rd_val;

  assign awready   = !aw_full;
  assign wready    = !w_full;
  assign arready   = !rvalid;
  assign do_write  = aw_full && w_full && !bvalid;

  assign wr_mapped = (aw_addr_q >> 4) == '0;
  assign rd_mapped = (araddr >> 4) == '0;
  assign wr_sel    = aw_addr_q[3:2];
  assign rd_sel    = araddr[3:2];

  always_comb begin
    case (wr_sel)
      2'd0:    wr_old = reg0;
      2'd1:    wr_old = reg1;
      2'd2:    wr_old = reg2;
      default: wr_old = reg3;
    endcase
    case (rd_sel)
      2'd0:    rd_val = reg0;
      2'd1:    rd_val = reg1;
      2'd2:    rd_val = reg2;
      default: rd_val = reg3;
    endcase
  end

  // byte-lane merge under wstrb
  always_comb begin
    for (int b = 0; b < 4; b++)
      wr_new[8*b +: 8] = w_strb_q[b] ? w_data_q[8*b +: 8] : wr_old[8*b +: 8];
  end

  always_ff @(posedge aclk or negedge aresetn) begin
    if (!aresetn) begin
      reg0 <= '0; reg1 <= '0; reg2 <= '0; reg3 <= '0;
      aw_full   <= 1'b0;
      w_full    <= 1'b0;
      aw_addr_q <= '0;
      w_data_q  <= '0;
      w_strb_q  <= '0;
      bvalid    <= 1'b0;
      bresp     <= RESP_OKAY;
      rvalid    <= 1'b0;
      rresp     <= RESP_OKAY;
      rdata     <= '0;
    end else begin
      // ---- write path ----
      if (awvalid && awready) begin
        aw_full   <= 1'b1;
        aw_addr_q <= awaddr;
      end
      if (wvalid && wready) begin
        w_full   <= 1'b1;
        w_data_q <= wdata;
        w_strb_q <= wstrb;
      end
      if (do_write) begin
        aw_full <= 1'b0;
        w_full  <= 1'b0;
        bvalid  <= 1'b1;
        bresp   <= wr_mapped ? RESP_OKAY : RESP_SLVERR;
        if (wr_mapped) begin
          case (wr_sel)
            2'd0:    reg0 <= wr_new;
            2'd1:    reg1 <= wr_new;
            2'd2:    reg2 <= wr_new;
            default: reg3 <= wr_new;
          endcase
        end
      end else if (bvalid && bready) begin
        bvalid <= 1'b0;
      end
      // ---- read path ----
      if (arvalid && arready) begin
        rvalid <= 1'b1;
        rdata  <= rd_mapped ? rd_val : 32'h0;
        rresp  <= rd_mapped ? RESP_OKAY : RESP_SLVERR;
      end else if (rvalid && rready) begin
        rvalid <= 1'b0;
      end
    end
  end
endmodule

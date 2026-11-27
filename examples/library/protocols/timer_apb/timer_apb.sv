// timer_apb: APB-programmable 32-bit down-counting timer with reload and interrupt
module timer_apb (
  input  logic        pclk,
  input  logic        presetn,
  input  logic        psel,
  input  logic        penable,
  input  logic        pwrite,
  input  logic [7:0]  paddr,
  input  logic [31:0] pwdata,
  output logic [31:0] prdata,
  output logic        pready,
  output logic        pslverr,
  output logic        irq
);
  logic [31:0] load_r, value_r;
  logic        enable, irq_en, pending;
  logic        mapped, wr_en, expire, irq_clr;
  logic [1:0]  sel;

  assign mapped  = (paddr[7:4] == 4'h0) && (paddr[1:0] == 2'b00);
  assign sel     = paddr[3:2];
  assign wr_en   = psel && penable && pwrite && mapped;
  assign expire  = enable && (value_r == 32'd0);
  assign irq_clr = wr_en && (sel == 2'd3) && pwdata[0];

  always_ff @(posedge pclk or negedge presetn) begin
    if (!presetn) begin
      load_r  <= '0;
      value_r <= '0;
      enable  <= 1'b0;
      irq_en  <= 1'b0;
      pending <= 1'b0;
    end else begin
      // counting
      if (enable) begin
        if (value_r == 32'd0) value_r <= load_r;
        else                  value_r <= value_r - 32'd1;
      end
      // register writes (a LOAD write overrides the counter update)
      if (wr_en) begin
        case (sel)
          2'd0: begin
            load_r  <= pwdata;
            value_r <= pwdata;
          end
          2'd2: begin
            enable <= pwdata[0];
            irq_en <= pwdata[1];
          end
          default: ;   // VALUE is read-only, STATUS handled below
        endcase
      end
      // a new expiry wins over a write-1-to-clear in the same cycle
      pending <= (pending && !irq_clr) || expire;
    end
  end

  always_comb begin
    prdata = '0;
    if (psel && !pwrite && mapped) begin
      case (sel)
        2'd0:    prdata = load_r;
        2'd1:    prdata = value_r;
        2'd2:    prdata = {30'd0, irq_en, enable};
        default: prdata = {31'd0, pending};
      endcase
    end
  end

  assign pready  = 1'b1;
  assign pslverr = psel && penable && !mapped;
  assign irq     = pending && irq_en;
endmodule

// apb_master_simple: issues one APB read or write per start pulse
module apb_master_simple #(
  parameter int ADDR_W = 8,
  parameter int DATA_W = 32
) (
  input  logic              pclk,
  input  logic              presetn,
  // command interface
  input  logic              start,     // begin a transfer (accepted only when idle)
  input  logic              write,     // 1 = write, 0 = read
  input  logic [ADDR_W-1:0] addr,
  input  logic [DATA_W-1:0] wdata,
  output logic [DATA_W-1:0] rdata,     // read data of the last completed read
  output logic              done,      // one-cycle pulse after the transfer completed
  output logic              error,     // pslverr of the last completed transfer
  output logic              busy,
  // APB requester interface
  output logic              psel,
  output logic              penable,
  output logic              pwrite,
  output logic [ADDR_W-1:0] paddr,
  output logic [DATA_W-1:0] pwdata,
  input  logic [DATA_W-1:0] prdata,
  input  logic              pready,
  input  logic              pslverr
);
  typedef enum logic [1:0] {IDLE, SETUP, ACCESS} state_t;
  state_t state, next_state;

  always_comb begin
    next_state = state;
    case (state)
      IDLE:    if (start)  next_state = SETUP;
      SETUP:   next_state = ACCESS;
      ACCESS:  if (pready) next_state = IDLE;
      default: next_state = IDLE;
    endcase
  end

  always_ff @(posedge pclk or negedge presetn) begin
    if (!presetn) begin
      state  <= IDLE;
      paddr  <= '0;
      pwrite <= 1'b0;
      pwdata <= '0;
      rdata  <= '0;
      done   <= 1'b0;
      error  <= 1'b0;
    end else begin
      state <= next_state;
      done  <= 1'b0;
      if (state == IDLE && start) begin
        paddr  <= addr;
        pwrite <= write;
        pwdata <= wdata;
      end
      if (state == ACCESS && pready) begin
        done  <= 1'b1;
        error <= pslverr;
        if (!pwrite) rdata <= prdata;
      end
    end
  end

  assign psel    = (state == SETUP) || (state == ACCESS);
  assign penable = (state == ACCESS);
  assign busy    = (state != IDLE);
endmodule

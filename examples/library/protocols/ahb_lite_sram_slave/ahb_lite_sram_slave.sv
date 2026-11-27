// ahb_lite_sram_slave: AHB-Lite slave with a 16 x 32-bit zero-wait-state memory
module ahb_lite_sram_slave (
  input  logic        hclk,
  input  logic        hresetn,
  input  logic        hsel,
  input  logic [31:0] haddr,
  input  logic [1:0]  htrans,
  input  logic        hwrite,
  input  logic [2:0]  hsize,
  input  logic [31:0] hwdata,
  output logic [31:0] hrdata,
  output logic        hready,
  output logic        hresp
);
  localparam logic [1:0] TRANS_NONSEQ = 2'b10;
  localparam logic [1:0] TRANS_SEQ    = 2'b11;

  logic [31:0] mem [16];

  // registered address-phase information, used in the data phase
  logic        dp_valid;
  logic        dp_write;
  logic [3:0]  dp_index;
  logic [3:0]  dp_be;       // byte lanes written
  logic [3:0]  be;
  logic [1:0]  lane;
  logic        active;
  logic [31:0] cur_word, merged;

  assign active = hsel && (htrans == TRANS_NONSEQ || htrans == TRANS_SEQ);

  assign lane = haddr[1:0];

  // byte enables from transfer size and the low address bits (little endian)
  always_comb begin
    case (hsize)
      3'd0:    be = 4'b0001 << lane;
      3'd1:    be = (lane >= 2'd2) ? 4'b1100 : 4'b0011;
      default: be = 4'b1111;   // word (larger sizes treated as word)
    endcase
  end

  assign cur_word = mem[dp_index];

  always_comb begin
    for (int b = 0; b < 4; b++)
      merged[8*b +: 8] = dp_be[b] ? hwdata[8*b +: 8] : cur_word[8*b +: 8];
  end

  always_ff @(posedge hclk or negedge hresetn) begin
    if (!hresetn) begin
      dp_valid <= 1'b0;
      dp_write <= 1'b0;
      dp_index <= '0;
      dp_be    <= '0;
      for (int i = 0; i < 16; i++) mem[i] <= '0;
    end else begin
      // data phase of the previous transfer: write the selected lanes
      if (dp_valid && dp_write) mem[dp_index] <= merged;
      // address phase of the current transfer (hready is always 1)
      dp_valid <= active;
      if (active) begin
        dp_write <= hwrite;
        dp_index <= haddr[5:2];
        dp_be    <= be;
      end
    end
  end

  assign hrdata = (dp_valid && !dp_write) ? cur_word : 32'h0;
  assign hready = 1'b1;   // zero wait states
  assign hresp  = 1'b0;   // always OKAY
endmodule

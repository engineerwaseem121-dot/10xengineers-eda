// fifo_sync: synchronous FIFO with registered read data, full/empty/count
module fifo_sync #(
  parameter int DEPTH = 8,                  // power of two, >= 2
  parameter int WIDTH = 8,
  parameter int AW    = $clog2(DEPTH),
  parameter int CW    = $clog2(DEPTH + 1)
) (
  input  logic             clk,
  input  logic             rst_n,
  input  logic             wr_en,
  input  logic [WIDTH-1:0] din,
  input  logic             rd_en,
  output logic [WIDTH-1:0] dout,
  output logic             full,
  output logic             empty,
  output logic [CW-1:0]    count
);
  logic [WIDTH-1:0] mem [0:DEPTH-1];
  logic [AW-1:0]    wptr, rptr;
  logic             do_wr, do_rd;

  assign full  = (count == CW'(DEPTH));
  assign empty = (count == '0);
  assign do_wr = wr_en && !full;
  assign do_rd = rd_en && !empty;

  always_ff @(posedge clk) begin
    if (do_wr) mem[wptr] <= din;
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      wptr  <= '0;
      rptr  <= '0;
      count <= '0;
      dout  <= '0;
    end else begin
      if (do_wr) wptr <= wptr + 1'b1;
      if (do_rd) begin
        dout <= mem[rptr];
        rptr <= rptr + 1'b1;
      end
      case ({do_wr, do_rd})
        2'b10:   count <= count + 1'b1;
        2'b01:   count <= count - 1'b1;
        default: count <= count;
      endcase
    end
  end
endmodule

// fifo_fwft: first-word-fall-through synchronous FIFO (head word visible on dout while not empty)
module fifo_fwft #(
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
  assign dout  = empty ? '0 : mem[rptr];    // head of the queue, no read latency

  always_ff @(posedge clk) begin
    if (do_wr) mem[wptr] <= din;
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      wptr  <= '0;
      rptr  <= '0;
      count <= '0;
    end else begin
      if (do_wr) wptr <= wptr + 1'b1;
      if (do_rd) rptr <= rptr + 1'b1;
      if (do_wr && !do_rd)      count <= count + 1'b1;
      else if (do_rd && !do_wr) count <= count - 1'b1;
    end
  end
endmodule

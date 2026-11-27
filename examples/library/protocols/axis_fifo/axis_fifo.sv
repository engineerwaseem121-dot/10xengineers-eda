// axis_fifo: 16-entry synchronous AXI-Stream FIFO carrying tdata and tlast
module axis_fifo #(
  parameter int DATA_W = 8,
  parameter int DEPTH  = 16          // power of two
) (
  input  logic              aclk,
  input  logic              aresetn,
  input  logic [DATA_W-1:0] s_axis_tdata,
  input  logic              s_axis_tvalid,
  input  logic              s_axis_tlast,
  output logic              s_axis_tready,
  output logic [DATA_W-1:0] m_axis_tdata,
  output logic              m_axis_tvalid,
  output logic              m_axis_tlast,
  input  logic              m_axis_tready
);
  localparam int AW = $clog2(DEPTH);

  logic [DATA_W:0] mem [DEPTH];      // {tlast, tdata}
  logic [AW-1:0]   wr_ptr, rd_ptr;
  logic [AW:0]     count;
  logic            push, pop;
  logic [DATA_W:0] head;

  assign s_axis_tready = (count != (AW+1)'(DEPTH));
  assign m_axis_tvalid = (count != '0);
  assign push = s_axis_tvalid && s_axis_tready;
  assign pop  = m_axis_tvalid && m_axis_tready;

  assign head          = mem[rd_ptr];
  assign m_axis_tdata  = head[DATA_W-1:0];
  assign m_axis_tlast  = head[DATA_W];

  always_ff @(posedge aclk) begin
    if (push) mem[wr_ptr] <= {s_axis_tlast, s_axis_tdata};
  end

  always_ff @(posedge aclk or negedge aresetn) begin
    if (!aresetn) begin
      wr_ptr <= '0;
      rd_ptr <= '0;
      count  <= '0;
    end else begin
      if (push) wr_ptr <= wr_ptr + 1'b1;
      if (pop)  rd_ptr <= rd_ptr + 1'b1;
      case ({push, pop})
        2'b10:   count <= count + 1'b1;
        2'b01:   count <= count - 1'b1;
        default: count <= count;
      endcase
    end
  end
endmodule

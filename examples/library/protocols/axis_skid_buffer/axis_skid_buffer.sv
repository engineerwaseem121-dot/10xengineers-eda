// axis_skid_buffer: AXI-Stream register slice with a skid register (full throughput, all outputs registered)
module axis_skid_buffer #(
  parameter int DATA_W = 8
) (
  input  logic              aclk,
  input  logic              aresetn,
  // upstream (slave) side
  input  logic [DATA_W-1:0] s_axis_tdata,
  input  logic              s_axis_tvalid,
  input  logic              s_axis_tlast,
  output logic              s_axis_tready,
  // downstream (master) side
  output logic [DATA_W-1:0] m_axis_tdata,
  output logic              m_axis_tvalid,
  output logic              m_axis_tlast,
  input  logic              m_axis_tready
);
  logic [DATA_W-1:0] skid_data;
  logic              skid_last;
  logic              skid_valid;
  logic              s_fire, out_free;

  assign s_axis_tready = !skid_valid;                       // registered ready
  assign s_fire        = s_axis_tvalid && s_axis_tready;
  assign out_free      = !m_axis_tvalid || m_axis_tready;   // output register can take a new beat

  always_ff @(posedge aclk or negedge aresetn) begin
    if (!aresetn) begin
      m_axis_tvalid <= 1'b0;
      m_axis_tdata  <= '0;
      m_axis_tlast  <= 1'b0;
      skid_valid    <= 1'b0;
      skid_data     <= '0;
      skid_last     <= 1'b0;
    end else if (out_free) begin
      if (skid_valid) begin
        // drain the skid register first (no input accepted this cycle: s_axis_tready = 0)
        m_axis_tvalid <= 1'b1;
        m_axis_tdata  <= skid_data;
        m_axis_tlast  <= skid_last;
        skid_valid    <= 1'b0;
      end else begin
        m_axis_tvalid <= s_fire;
        if (s_fire) begin
          m_axis_tdata <= s_axis_tdata;
          m_axis_tlast <= s_axis_tlast;
        end
      end
    end else if (s_fire) begin
      // output stalled: park the accepted beat in the skid register
      skid_valid <= 1'b1;
      skid_data  <= s_axis_tdata;
      skid_last  <= s_axis_tlast;
    end
  end
endmodule

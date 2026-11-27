`timescale 1ns/1ps
module axis_skid_buffer_check;
  logic       aclk = 0, aresetn = 0;
  logic [7:0] s_tdata = 0, m_tdata;
  logic       s_tvalid = 0, s_tlast = 0, s_tready;
  logic       m_tvalid, m_tlast, m_tready = 0;
  int errors = 0, nsent = 0, nrecv = 0, full_rate = 0;
  integer seed = 32'h5C1D;
  int p_valid, p_ready;   // per-mille probabilities of the random phase

  axis_skid_buffer #(.DATA_W(8)) dut (.aclk(aclk), .aresetn(aresetn),
    .s_axis_tdata(s_tdata), .s_axis_tvalid(s_tvalid), .s_axis_tlast(s_tlast), .s_axis_tready(s_tready),
    .m_axis_tdata(m_tdata), .m_axis_tvalid(m_tvalid), .m_axis_tlast(m_tlast), .m_axis_tready(m_tready));
  always #5 aclk = ~aclk;
  initial begin #3000000; $display("CHECK FAIL timeout"); $finish; end

  // reference: a queue of sent beats; every received beat must match the head
  logic [8:0] q [$];
  logic       prev_mv, prev_mr; logic [8:0] prev_m;

  always @(posedge aclk) begin
    if (aresetn) begin
      // stability: a valid beat that was not taken must stay unchanged
      if (prev_mv && !prev_mr && (!m_tvalid || {m_tlast, m_tdata} !== prev_m)) begin
        errors++; $display("m_axis beat changed while stalled");
      end
      if (s_tvalid && s_tready) begin q.push_back({s_tlast, s_tdata}); nsent++; end
      if (m_tvalid && m_tready) begin
        if (q.size() == 0) begin errors++; $display("output without input"); end
        else begin : pop
          logic [8:0] e; e = q.pop_front();
          if ({m_tlast, m_tdata} !== e) begin errors++; if (errors < 10) $display("got %h exp %h", {m_tlast, m_tdata}, e); end
        end
        nrecv++;
      end
      if (s_tvalid && s_tready && m_tvalid && m_tready) full_rate++;
      prev_mv = m_tvalid; prev_mr = m_tready; prev_m = {m_tlast, m_tdata};
    end
  end

  // source keeps a beat stable until accepted; sink drives ready randomly
  logic [7:0] cnt;
  logic       s_tready_q;
  always @(negedge aclk) begin
    if (aresetn) begin
      if (!s_tvalid || s_tready_q) begin
        s_tvalid = ($random(seed) % 1000 + 1000) % 1000 < p_valid;
        s_tdata = cnt; s_tlast = (cnt[2:0] == 3'd7);
        if (s_tvalid) cnt++;
      end
      m_tready = ($random(seed) % 1000 + 1000) % 1000 < p_ready;
    end
  end
  // s_tready sampled at the rising edge (handshake happened)
  always @(posedge aclk) s_tready_q = s_tvalid && s_tready;

  initial begin
    prev_mv = 0; prev_mr = 0; cnt = 0; s_tready_q = 0;
    p_valid = 1000; p_ready = 1000;
    #22 aresetn = 1;
    if (m_tvalid !== 0) errors++;
    repeat (200) @(posedge aclk);           // full throughput phase
    p_valid = 600; p_ready = 500;
    repeat (4000) @(posedge aclk);          // random phase
    p_valid = 1000; p_ready = 200;
    repeat (1000) @(posedge aclk);          // back-pressure phase
    p_valid = 0; p_ready = 1000;
    repeat (20) @(posedge aclk);
    if (errors == 0 && q.size() == 0 && nrecv == nsent && full_rate > 190) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d sent=%0d recv=%0d left=%0d full_rate=%0d", errors, nsent, nrecv, q.size(), full_rate);
    $finish;
  end
endmodule

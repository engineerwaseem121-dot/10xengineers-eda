`timescale 1ns/1ps
module axis_fifo_check;
  logic       aclk = 0, aresetn = 0;
  logic [7:0] s_tdata = 0, m_tdata;
  logic       s_tvalid = 0, s_tlast = 0, s_tready;
  logic       m_tvalid, m_tlast, m_tready = 0;
  int errors = 0, nsent = 0, nrecv = 0, nfull = 0, nsame = 0;
  integer seed = 32'hF1F0;
  int p_valid, p_ready;

  axis_fifo #(.DATA_W(8), .DEPTH(16)) dut (.aclk(aclk), .aresetn(aresetn),
    .s_axis_tdata(s_tdata), .s_axis_tvalid(s_tvalid), .s_axis_tlast(s_tlast), .s_axis_tready(s_tready),
    .m_axis_tdata(m_tdata), .m_axis_tvalid(m_tvalid), .m_axis_tlast(m_tlast), .m_axis_tready(m_tready));
  always #5 aclk = ~aclk;
  initial begin #3000000; $display("CHECK FAIL timeout"); $finish; end

  logic [8:0] q [$];   // reference FIFO
  logic [7:0] cnt;
  logic       s_hs;

  // compare flags and data against the reference just before each rising edge
  always @(negedge aclk) begin
    if (aresetn) begin
      #2;
      if (s_tready !== (q.size() < 16) || m_tvalid !== (q.size() > 0)) begin
        errors++; if (errors < 10) $display("flags: ready=%b valid=%b level=%0d", s_tready, m_tvalid, q.size());
      end
      if (q.size() > 0 && {m_tlast, m_tdata} !== q[0]) begin
        errors++; if (errors < 10) $display("head %h exp %h", {m_tlast, m_tdata}, q[0]);
      end
      if (q.size() == 16) nfull++;
    end
  end

  always @(posedge aclk) begin
    if (aresetn) begin
      s_hs = s_tvalid && s_tready;
      if (m_tvalid && m_tready) begin void'(q.pop_front()); nrecv++; end
      if (s_hs) begin q.push_back({s_tlast, s_tdata}); nsent++; end
      if (s_hs && m_tvalid && m_tready) nsame++;
    end
  end

  // stimulus on negedge: hold a beat until it is accepted
  always @(negedge aclk) begin
    if (aresetn) begin
      if (!s_tvalid || s_hs) begin
        s_tvalid = ($random(seed) % 1000 + 1000) % 1000 < p_valid;
        s_tdata = $random(seed); s_tlast = ($random(seed) & 3) == 0;
      end
      m_tready = ($random(seed) % 1000 + 1000) % 1000 < p_ready;
    end
  end

  initial begin
    s_hs = 0; cnt = 0;
    p_valid = 1000; p_ready = 0;
    #22 aresetn = 1;
    repeat (30) @(posedge aclk);            // fill to full
    p_valid = 0; p_ready = 1000;
    repeat (30) @(posedge aclk);            // drain to empty
    p_valid = 1000; p_ready = 1000;
    repeat (100) @(posedge aclk);           // streaming
    for (int ph = 0; ph < 20; ph++) begin
      p_valid = ($random(seed) & 1023) % 1000; p_ready = ($random(seed) & 1023) % 1000;
      repeat (300) @(posedge aclk);
    end
    p_valid = 0; p_ready = 1000;
    repeat (40) @(posedge aclk);
    if (errors == 0 && q.size() == 0 && nsent == nrecv && nfull > 20 && nsame > 100) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d sent=%0d recv=%0d full_cycles=%0d", errors, nsent, nrecv, nfull);
    $finish;
  end
endmodule

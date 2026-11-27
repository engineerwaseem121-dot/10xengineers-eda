`timescale 1ns/1ps
module axi4lite_slave_regs_check;
  logic        aclk = 0, aresetn = 0;
  logic [7:0]  awaddr = 0, araddr = 0;
  logic [2:0]  awprot = 0, arprot = 0;
  logic        awvalid = 0, wvalid = 0, bready = 0, arvalid = 0, rready = 0;
  logic        awready, wready, bvalid, arready, rvalid;
  logic [31:0] wdata = 0, rdata;
  logic [3:0]  wstrb = 0;
  logic [1:0]  bresp, rresp;
  int errors = 0, nslverr = 0, nw_first = 0;
  integer seed = 32'hA11;

  axi4lite_slave_regs dut (.aclk(aclk), .aresetn(aresetn),
    .awaddr(awaddr), .awprot(awprot), .awvalid(awvalid), .awready(awready),
    .wdata(wdata), .wstrb(wstrb), .wvalid(wvalid), .wready(wready),
    .bresp(bresp), .bvalid(bvalid), .bready(bready),
    .araddr(araddr), .arprot(arprot), .arvalid(arvalid), .arready(arready),
    .rdata(rdata), .rresp(rresp), .rvalid(rvalid), .rready(rready));
  always #5 aclk = ~aclk;
  initial begin #5000000; $display("CHECK FAIL timeout"); $finish; end

  logic [31:0] model [4];

  // ---------------- bus-functional model ----------------
  // AW and W are driven independently: AW valid from cycle da, W valid from cycle dw
  task automatic axi_aw_w(input logic [7:0] a, input logic [31:0] d, input logic [3:0] s,
                          input int da, input int dw);
    bit aw_done, w_done; int cnt;
    aw_done = 0; w_done = 0; cnt = 0;
    while (!(aw_done && w_done) && cnt < 50) begin
      @(negedge aclk);
      awvalid = !aw_done && cnt >= da; awaddr = awvalid ? a : 8'($random(seed)); awprot = $random(seed);
      wvalid  = !w_done && cnt >= dw;  wdata = wvalid ? d : $random(seed);       wstrb = wvalid ? s : 4'($random(seed));
      @(posedge aclk);
      if (awvalid && awready) aw_done = 1;
      if (wvalid && wready) w_done = 1;
      cnt++;
    end
    if (cnt >= 50) begin errors++; $display("AW/W handshake stuck"); end
    @(negedge aclk) begin awvalid = 0; wvalid = 0; end
  endtask

  task automatic wait_b(input int db, output logic [1:0] resp);
    int t;
    repeat (db) @(negedge aclk);
    bready = 1;
    t = 0;
    do begin @(posedge aclk); t++; end while (!bvalid && t < 50);
    if (t >= 50) begin errors++; $display("no bvalid"); end
    resp = bresp;
    @(negedge aclk) bready = 0;
  endtask

  task automatic axi_write(input logic [7:0] a, input logic [31:0] d, input logic [3:0] s, output logic [1:0] resp);
    int da, dw;
    da = $random(seed) & 3; dw = $random(seed) & 3;
    if (dw < da) nw_first++;
    axi_aw_w(a, d, s, da, dw);
    wait_b($random(seed) & 3, resp);
  endtask

  task automatic axi_read(input logic [7:0] a, output logic [31:0] d, output logic [1:0] resp);
    int dr;
    dr = $random(seed) & 3;
    @(negedge aclk) begin arvalid = 1; araddr = a; arprot = $random(seed); end
    begin : w_ar int t; t = 0; do begin @(posedge aclk); t++; end while (!arready && t < 50); if (t >= 50) errors++; end
    @(negedge aclk) begin arvalid = 0; araddr = $random(seed); end
    repeat (dr) @(negedge aclk);
    @(negedge aclk) rready = 1;
    begin : w_r int t; t = 0; do begin @(posedge aclk); t++; end while (!rvalid && t < 50); if (t >= 50) errors++; end
    d = rdata; resp = rresp;
    @(negedge aclk) rready = 0;
  endtask
  // -------------------------------------------------------

  // protocol check: once valid is high it stays high (with stable payload) until ready
  logic pb_v, pr_v; logic [1:0] pb_resp; logic [31:0] pr_data;
  always @(posedge aclk) begin
    if (aresetn) begin
      if (pb_v && !bready && (!bvalid || bresp !== pb_resp)) begin errors++; $display("B changed before handshake"); end
      if (pr_v && !rready && (!rvalid || rdata !== pr_data)) begin errors++; $display("R changed before handshake"); end
    end
    #1; pb_v = bvalid && !bready; pb_resp = bresp; pr_v = rvalid && !rready; pr_data = rdata;
  end

  function automatic bit mapped(logic [7:0] a); return a[7:4] == 0; endfunction

  task automatic do_write(input logic [7:0] a, input logic [31:0] d, input logic [3:0] s);
    logic [1:0] r;
    axi_write(a, d, s, r);
    if (mapped(a)) for (int b = 0; b < 4; b++) if (s[b]) model[a[3:2]][8*b +: 8] = d[8*b +: 8];
    if (r !== (mapped(a) ? 2'b00 : 2'b10)) begin errors++; $display("bresp %b for %h", r, a); end
    if (r == 2'b10) nslverr++;
  endtask

  task automatic do_read(input logic [7:0] a);
    logic [1:0] r; logic [31:0] d, exp;
    axi_read(a, d, r);
    exp = mapped(a) ? model[a[3:2]] : 32'h0;
    if (d !== exp || r !== (mapped(a) ? 2'b00 : 2'b10)) begin
      errors++; if (errors < 10) $display("read %h got %h/%b exp %h", a, d, r, exp);
    end
  endtask

  initial begin
    pb_v = 0; pr_v = 0;
    foreach (model[i]) model[i] = 0;
    #22 aresetn = 1;
    for (int i = 0; i < 4; i++) do_read(i * 4);
    do_write(8'h0, 32'h11223344, 4'hF); do_write(8'h4, 32'h55667788, 4'hF);
    do_write(8'h8, 32'hAABBCCDD, 4'b0101); do_write(8'hC, 32'hFFFFFFFF, 4'b1000);
    for (int i = 0; i < 4; i++) do_read(i * 4);
    do_write(8'h20, 32'h1, 4'hF); do_read(8'h24); do_read(8'h3);
    // W strictly before AW
    begin : dirw logic [1:0] r;
      axi_aw_w(8'h4, 32'hC0FFEE00, 4'hF, 6, 0);
      wait_b(0, r);
      if (r !== 0) errors++;
      axi_aw_w(8'h8, 32'h0BADF00D, 4'hF, 0, 4);   // AW well before W
      wait_b(2, r);
      model[2] = 32'h0BADF00D;
    end
    model[1] = 32'hC0FFEE00;
    do_read(8'h4);
    for (int i = 0; i < 2000; i++) begin
      logic [7:0] a;
      a = (($random(seed) & 7) == 0) ? $random(seed) : 8'($random(seed) & 8'h0F);
      if ($random(seed) & 1) do_write(a, $random(seed), $random(seed)); else do_read(a);
    end
    if (errors == 0 && nslverr > 50 && nw_first > 100) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d slverr=%0d w_first=%0d", errors, nslverr, nw_first);
    $finish;
  end
endmodule

`timescale 1ns/1ps
module timer_apb_check;
  logic        pclk = 0, presetn = 0;
  logic        psel = 0, penable = 0, pwrite = 0;
  logic [7:0]  paddr = 0;
  logic [31:0] pwdata = 0, prdata;
  logic        pready, pslverr, irq;
  int errors = 0, nirq = 0, nexp = 0;
  integer seed = 32'h7173;

  timer_apb dut (.pclk(pclk), .presetn(presetn), .psel(psel), .penable(penable), .pwrite(pwrite),
    .paddr(paddr), .pwdata(pwdata), .prdata(prdata), .pready(pready), .pslverr(pslverr), .irq(irq));
  always #5 pclk = ~pclk;
  initial begin #5000000; $display("CHECK FAIL timeout"); $finish; end

  // ---------------- independent cycle model, updated on every rising edge ----------------
  logic [31:0] m_load, m_value;
  bit m_en, m_ie, m_pend;
  always @(posedge pclk) begin
    if (presetn) begin : mdl
      bit w, exp_now, clr;
      logic [31:0] nv;
      w = psel && penable && pwrite && paddr[7:4] == 0 && paddr[1:0] == 0;
      exp_now = m_en && m_value == 0;
      clr = w && paddr[3:2] == 3 && pwdata[0];
      nv = m_value;
      if (m_en) nv = (m_value == 0) ? m_load : m_value - 1;
      if (w && paddr[3:2] == 0) begin m_load = pwdata; nv = pwdata; end
      if (w && paddr[3:2] == 2) begin m_en = pwdata[0]; m_ie = pwdata[1]; end
      m_pend = (m_pend && !clr) || exp_now;
      if (exp_now) nexp++;
      m_value = nv;
      #1;
      if (irq !== (m_pend && m_ie)) begin
        errors++; if (errors < 10) $display("irq mismatch t=%0t irq=%b exp=%b", $time, irq, m_pend && m_ie);
      end
      if (irq) nirq++;
    end
  end
  // ----------------------------------------------------------------------------------------

  task automatic apb_write(input logic [7:0] a, input logic [31:0] d, output logic err);
    @(negedge pclk); psel = 1; penable = 0; pwrite = 1; paddr = a; pwdata = d;
    @(negedge pclk); penable = 1;
    do @(posedge pclk); while (!pready);
    err = pslverr;
    @(negedge pclk); psel = 0; penable = 0;
  endtask

  task automatic apb_read(input logic [7:0] a, output logic [31:0] d, output logic err);
    @(negedge pclk); psel = 1; penable = 0; pwrite = 0; paddr = a;
    @(negedge pclk); penable = 1;
    do @(posedge pclk); while (!pready);
    d = prdata; err = pslverr;
    // expected value as seen just before this edge's model update
    @(negedge pclk); psel = 0; penable = 0;
  endtask

  // read and compare against the model state that was current during the access phase
  task automatic check_read(input logic [7:0] a);
    logic [31:0] d, exp; logic e; bit mapped;
    mapped = a[7:4] == 0 && a[1:0] == 0;
    @(negedge pclk); psel = 1; penable = 0; pwrite = 0; paddr = a;
    @(negedge pclk); penable = 1;
    #1;
    case (a[3:2])
      0: exp = m_load;
      1: exp = m_value;
      2: exp = {30'd0, m_ie, m_en};
      default: exp = {31'd0, m_pend};
    endcase
    if (!mapped) exp = 0;
    d = prdata;
    @(posedge pclk); e = pslverr;
    if (d !== exp || e !== !mapped) begin
      errors++; if (errors < 10) $display("read %h got %h exp %h err=%b", a, d, exp, e);
    end
    @(negedge pclk); psel = 0; penable = 0;
  endtask

  initial begin
    logic e; logic [31:0] d;
    m_load = 0; m_value = 0; m_en = 0; m_ie = 0; m_pend = 0;
    #22 presetn = 1;
    for (int i = 0; i < 4; i++) check_read(i * 4);
    // directed: LOAD=5, enable with irq
    apb_write(8'h00, 32'd5, e);
    check_read(8'h04);
    apb_write(8'h08, 32'h3, e);
    repeat (5) check_read(8'h04);
    if (!irq) begin errors++; $display("irq expected after expiry"); end
    check_read(8'h0C);
    apb_write(8'h0C, 32'h1, e);        // W1C
    apb_write(8'h04, 32'hFFFF, e);     // VALUE is read-only
    if (e) begin errors++; $display("VALUE write must not error"); end
    apb_write(8'h08, 32'h1, e);        // irq disabled, still counting
    repeat (10) check_read(8'h0C);
    apb_write(8'h20, 32'h1, e);
    if (!e) begin errors++; $display("unmapped write must error"); end
    check_read(8'h21);
    apb_write(8'h08, 32'h0, e);        // stop
    check_read(8'h04); check_read(8'h04);
    // random register traffic
    for (int i = 0; i < 3000; i++) begin
      int r; r = $random(seed) & 15;
      case (r)
        0: apb_write(8'h00, $random(seed) & 32'h1F, e);
        1: apb_write(8'h08, $random(seed) & 3, e);
        2, 3: apb_write(8'h0C, $random(seed), e);
        4: apb_write(8'h04, $random(seed), e);
        5: apb_write(8'h40, $random(seed), e);
        6: check_read(8'h80);
        default: check_read(8'($random(seed) & 12));
      endcase
    end
    if (errors == 0 && nirq > 100 && nexp > 50) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d irq_cycles=%0d expiries=%0d", errors, nirq, nexp);
    $finish;
  end
endmodule

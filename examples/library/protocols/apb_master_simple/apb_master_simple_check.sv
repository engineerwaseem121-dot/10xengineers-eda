`timescale 1ns/1ps
module apb_master_simple_check;
  logic        pclk = 0, presetn = 0;
  logic        start = 0, write = 0;
  logic [7:0]  addr = 0;
  logic [31:0] wdata = 0, rdata;
  logic        done, error, busy;
  logic        psel, penable, pwrite;
  logic [7:0]  paddr;
  logic [31:0] pwdata, prdata;
  logic        pready, pslverr;
  int errors = 0, nxfer = 0, nwait = 0;
  integer seed = 32'h5EED;

  apb_master_simple dut (.pclk(pclk), .presetn(presetn), .start(start), .write(write), .addr(addr),
    .wdata(wdata), .rdata(rdata), .done(done), .error(error), .busy(busy),
    .psel(psel), .penable(penable), .pwrite(pwrite), .paddr(paddr), .pwdata(pwdata),
    .prdata(prdata), .pready(pready), .pslverr(pslverr));
  always #5 pclk = ~pclk;
  initial begin #3000000; $display("CHECK FAIL timeout"); $finish; end

  // ---------------- behavioural APB completer with random wait states ----------------
  logic [31:0] mem [256];
  int waits;
  logic prev_psel, prev_pen;
  logic [7:0] prev_addr;
  assign pslverr = psel && penable && pready && paddr[7];       // upper half of map is "unmapped"
  assign prdata  = (psel && penable && pready && !pwrite) ? (paddr[7] ? 32'h0 : mem[paddr]) : 32'hx;
  initial begin pready = 0; prev_psel = 0; prev_pen = 0; end
  always @(posedge pclk) begin
    // protocol checks on the requester
    if (penable && !psel) begin errors++; $display("penable without psel"); end
    if (psel && penable && !prev_psel) begin errors++; $display("access phase without setup"); end
    if (psel && prev_psel && prev_pen == 0 && !penable) begin errors++; $display("setup phase longer than one cycle"); end
    if (psel && prev_psel && paddr !== prev_addr) begin errors++; $display("paddr changed mid-transfer"); end
    if (psel && penable && pready) begin
      if (pwrite && !paddr[7]) mem[paddr] = pwdata;
      nxfer++;
    end
    prev_psel = psel; prev_pen = penable; prev_addr = paddr;
  end
  // drive pready on negedge: random 0..3 wait states in the access phase
  always @(negedge pclk) begin
    if (psel && penable && !pready) begin
      if (waits == 0) pready = 1; else waits--;
    end else if (psel && !penable) begin
      waits = $random(seed) & 3; if (waits) nwait++;
      pready = (waits == 0);
    end else pready = 0;
  end
  // -----------------------------------------------------------------------------------

  logic [31:0] model [256];

  task automatic xfer(input logic w, input logic [7:0] a, input logic [31:0] d);
    int t;
    @(negedge pclk); start = 1; write = w; addr = a; wdata = d;
    @(negedge pclk); start = 0; write = $random(seed); addr = $random(seed); wdata = $random(seed);
    t = 0;
    while (!done && t <= 20) begin @(negedge pclk); t++; end
    if (t > 20) begin errors++; $display("no done"); end
    if (error !== a[7]) begin errors++; $display("error flag %b for addr %h", error, a); end
    if (w) begin if (!a[7]) model[a] = d; end
    else if (rdata !== (a[7] ? 32'h0 : model[a])) begin
      errors++;
      if (errors < 10) $display("read %h got %h exp %h", a, rdata, model[a]);
    end
    @(negedge pclk);
    if (done !== 0 || busy !== 0) begin errors++; $display("done not a pulse / busy stuck"); end
  endtask

  initial begin
    for (int i = 0; i < 256; i++) begin mem[i] = 0; model[i] = 0; end
    waits = 0;
    #22 presetn = 1;
    if (psel !== 0 || penable !== 0 || busy !== 0 || done !== 0) begin errors++; $display("bad reset outputs"); end
    xfer(1, 8'h10, 32'hA5A5A5A5);
    xfer(0, 8'h10, 0);
    xfer(1, 8'h90, 32'h1);    // error response
    xfer(0, 8'h90, 0);
    // start pulses while busy are ignored
    @(negedge pclk); start = 1; write = 1; addr = 8'h20; wdata = 32'h77;
    @(negedge pclk); start = 1; addr = 8'h21; wdata = 32'h88;   // busy: ignored
    @(negedge pclk); start = 0;
    while (busy) @(negedge pclk);
    model[8'h20] = 32'h77;
    xfer(0, 8'h20, 0); xfer(0, 8'h21, 0);
    for (int i = 0; i < 1500; i++) begin
      logic [7:0] a;
      a = ($random(seed) & 15) == 0 ? 8'h80 | $random(seed) : 8'($random(seed) & 8'h1F);
      xfer($random(seed), a, $random(seed));
    end
    if (errors == 0 && nwait > 100) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d waits=%0d", errors, nwait);
    $finish;
  end
endmodule

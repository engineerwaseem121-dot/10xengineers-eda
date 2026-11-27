`timescale 1ns/1ps
module apb_slave_regs_check;
  logic        pclk = 0, presetn = 0;
  logic        psel = 0, penable = 0, pwrite = 0;
  logic [7:0]  paddr = 0;
  logic [31:0] pwdata = 0, prdata;
  logic        pready, pslverr;
  int errors = 0, nerr_resp = 0;
  integer seed = 32'hA9B;
  logic [31:0] model [4];

  apb_slave_regs dut (.pclk(pclk), .presetn(presetn), .psel(psel), .penable(penable), .pwrite(pwrite),
    .paddr(paddr), .pwdata(pwdata), .prdata(prdata), .pready(pready), .pslverr(pslverr));
  always #5 pclk = ~pclk;
  initial begin #2000000; $display("CHECK FAIL timeout"); $finish; end

  // bus-functional model: setup phase, then access phase until pready
  task automatic apb_write(input logic [7:0] a, input logic [31:0] d, output logic err);
    @(negedge pclk); psel = 1; penable = 0; pwrite = 1; paddr = a; pwdata = d;
    if (pslverr !== 0) begin errors++; $display("pslverr in setup phase"); end
    @(negedge pclk); penable = 1;
    do @(posedge pclk); while (!pready);
    err = pslverr;
    @(negedge pclk); psel = 0; penable = 0; pwdata = $random(seed);
  endtask

  task automatic apb_read(input logic [7:0] a, output logic [31:0] d, output logic err);
    @(negedge pclk); psel = 1; penable = 0; pwrite = 0; paddr = a;
    @(negedge pclk); penable = 1;
    do @(posedge pclk); while (!pready);
    d = prdata; err = pslverr;
    @(negedge pclk); psel = 0; penable = 0;
  endtask

  function automatic bit is_mapped(logic [7:0] a);
    return a[7:4] == 0 && a[1:0] == 0;
  endfunction

  task automatic do_write(input logic [7:0] a, input logic [31:0] d);
    logic e;
    apb_write(a, d, e);
    if (is_mapped(a)) model[a[3:2]] = d;
    if (e !== !is_mapped(a)) begin errors++; $display("write %h: pslverr=%b", a, e); end
    if (e) nerr_resp++;
  endtask

  task automatic do_read(input logic [7:0] a);
    logic e; logic [31:0] d, exp;
    apb_read(a, d, e);
    exp = is_mapped(a) ? model[a[3:2]] : 32'h0;
    if (e !== !is_mapped(a) || d !== exp) begin
      errors++;
      if (errors < 10) $display("read %h: got %h err=%b exp %h", a, d, e, exp);
    end
  endtask

  initial begin
    foreach (model[i]) model[i] = 0;
    #22 presetn = 1;
    // reset values
    for (int i = 0; i < 4; i++) do_read(i * 4);
    // directed writes/reads
    do_write(8'h00, 32'hDEADBEEF); do_write(8'h04, 32'h12345678);
    do_write(8'h08, 32'hCAFEF00D); do_write(8'h0C, 32'h0000FFFF);
    for (int i = 0; i < 4; i++) do_read(i * 4);
    // unmapped and unaligned accesses: error, no effect
    do_write(8'h10, 32'h11111111); do_write(8'h02, 32'h22222222); do_write(8'hFC, 32'h3);
    do_read(8'h10); do_read(8'h05);
    for (int i = 0; i < 4; i++) do_read(i * 4);
    // random traffic
    for (int i = 0; i < 2000; i++) begin
      logic [7:0] a;
      a = ($random(seed) & 7) == 0 ? $random(seed) : {4'h0, 2'($random(seed)), 2'b00};
      if ($random(seed) & 1) do_write(a, $random(seed)); else do_read(a);
    end
    // async reset clears registers
    #3 presetn = 0; #7 presetn = 1;
    foreach (model[i]) model[i] = 0;
    for (int i = 0; i < 4; i++) do_read(i * 4);
    if (errors == 0 && nerr_resp > 50) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d err_responses=%0d", errors, nerr_resp);
    $finish;
  end
endmodule

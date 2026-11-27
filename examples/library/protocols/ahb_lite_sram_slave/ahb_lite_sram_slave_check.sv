`timescale 1ns/1ps
module ahb_lite_sram_slave_check;
  logic        hclk = 0, hresetn = 0;
  logic        hsel = 0, hwrite = 0;
  logic [31:0] haddr = 0, hwdata = 0, hrdata;
  logic [1:0]  htrans = 0;
  logic [2:0]  hsize = 0;
  logic        hready, hresp;
  int errors = 0, nrd = 0, nwr = 0;
  integer seed = 32'hA4B;

  ahb_lite_sram_slave dut (.hclk(hclk), .hresetn(hresetn), .hsel(hsel), .haddr(haddr), .htrans(htrans),
    .hwrite(hwrite), .hsize(hsize), .hwdata(hwdata), .hrdata(hrdata), .hready(hready), .hresp(hresp));
  always #5 hclk = ~hclk;
  initial begin #3000000; $display("CHECK FAIL timeout"); $finish; end

  logic [31:0] model [16];

  // transfer currently in its data phase
  bit          dp_v, dp_w;
  logic [31:0] dp_a, dp_d;
  logic [2:0]  dp_s;

  function automatic logic [31:0] merge(logic [31:0] old, logic [31:0] d, logic [31:0] a, logic [2:0] s);
    logic [31:0] r; r = old;
    case (s)
      0: r[8*a[1:0] +: 8] = d[8*a[1:0] +: 8];
      1: r[16*a[1] +: 16] = d[16*a[1] +: 16];
      default: r = d;
    endcase
    return r;
  endfunction

  // one bus cycle: drive the next address phase (and data for the transfer in data phase)
  task automatic cycle(input bit sel, input logic [1:0] tr, input bit w, input logic [31:0] a, input logic [2:0] s);
    logic [31:0] d;
    @(negedge hclk);
    // check read data / hready / hresp of the transfer in its data phase
    if (hready !== 1 || hresp !== 0) begin errors++; $display("hready/hresp wrong"); end
    if (dp_v && !dp_w) begin
      nrd++;
      if (hrdata !== model[dp_a[5:2]]) begin
        errors++; if (errors < 10) $display("read %h got %h exp %h", dp_a, hrdata, model[dp_a[5:2]]);
      end
    end
    d = $random(seed);
    hwdata = (dp_v && dp_w) ? dp_d : $random(seed);
    hsel = sel; htrans = tr; hwrite = w; haddr = a; hsize = s;
    @(posedge hclk);
    if (dp_v && dp_w) begin model[dp_a[5:2]] = merge(model[dp_a[5:2]], dp_d, dp_a, dp_s); nwr++; end
    dp_v = sel && tr[1]; dp_w = w; dp_a = a; dp_s = s; dp_d = d;
  endtask

  initial begin
    foreach (model[i]) model[i] = 0;
    dp_v = 0;
    #22 hresetn = 1;
    // directed: word writes, then reads back-to-back
    for (int i = 0; i < 16; i++) cycle(1, 2'b10, 1, i * 4, 3'd2);
    for (int i = 0; i < 16; i++) cycle(1, (i == 0) ? 2'b10 : 2'b11, 0, i * 4, 3'd2);
    // byte and halfword writes, read after write to the same address
    cycle(1, 2'b10, 1, 32'h1, 3'd0); cycle(1, 2'b10, 0, 32'h0, 3'd2);
    cycle(1, 2'b10, 1, 32'h6, 3'd1); cycle(1, 2'b10, 0, 32'h4, 3'd2);
    // IDLE and BUSY and unselected transfers do nothing
    cycle(1, 2'b00, 1, 32'h8, 3'd2); cycle(1, 2'b01, 1, 32'hC, 3'd2); cycle(0, 2'b10, 1, 32'h10, 3'd2);
    cycle(1, 2'b10, 0, 32'h8, 3'd2); cycle(1, 2'b10, 0, 32'hC, 3'd2); cycle(1, 2'b10, 0, 32'h10, 3'd2);
    for (int i = 0; i < 5000; i++) begin
      logic [2:0] s; logic [31:0] a;
      s = $random(seed) % 3; if (s > 2) s = 2;
      a = $random(seed);
      if (s == 1) a[0] = 0; else if (s == 2) a[1:0] = 0;
      cycle(($random(seed) & 7) != 0, $random(seed), $random(seed), a, s);
    end
    cycle(0, 0, 0, 0, 0); cycle(0, 0, 0, 0, 0);
    if (errors == 0 && nrd > 1000 && nwr > 1000) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d reads=%0d writes=%0d", errors, nrd, nwr);
    $finish;
  end
endmodule

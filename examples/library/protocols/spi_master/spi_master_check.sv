`timescale 1ns/1ps
module spi_master_check;
  localparam int DIV = 3;
  logic       clk = 0, rst_n = 0, start = 0;
  logic [7:0] tx_data = 0, rx_data;
  logic       done, busy, sclk, mosi, miso, cs_n;
  int errors = 0, nxfer = 0;
  integer seed = 32'h5B1;

  spi_master #(.CLK_DIV(DIV)) dut (.clk(clk), .rst_n(rst_n), .start(start), .tx_data(tx_data),
    .rx_data(rx_data), .done(done), .busy(busy), .sclk(sclk), .mosi(mosi), .miso(miso), .cs_n(cs_n));
  always #5 clk = ~clk;
  initial begin #5000000; $display("CHECK FAIL timeout"); $finish; end

  // ---------------- mode-0 SPI slave model (event driven) ----------------
  logic [7:0] s_tx, s_rx, s_tx_next;
  int         s_edges;
  assign miso = cs_n ? 1'bz : s_tx[7];
  always @(negedge cs_n) begin s_tx = s_tx_next; s_rx = 0; s_edges = 0; end
  always @(posedge sclk) begin
    if (cs_n) begin errors++; $display("sclk rising while cs_n high"); end
    s_rx = {s_rx[6:0], mosi}; s_edges++;
  end
  always @(negedge sclk) if (!cs_n) s_tx = {s_tx[6:0], 1'b0};
  // mosi must be stable while sclk is high
  always @(mosi) if (sclk && !cs_n) begin errors++; $display("mosi changed while sclk high"); end
  // -----------------------------------------------------------------------

  // sclk half-period measurement
  realtime last_edge; int bad_period = 0;
  always @(sclk) begin
    if (!cs_n && last_edge > 0 && ($realtime - last_edge) != DIV * 10.0) bad_period++;
    last_edge = $realtime;
  end

  task automatic xfer(input logic [7:0] m, input logic [7:0] s);
    int t;
    s_tx_next = s;
    @(negedge clk); start = 1; tx_data = m;
    @(negedge clk); start = 0; tx_data = $random(seed);
    if (!busy || cs_n) begin errors++; $display("not busy after start"); end
    last_edge = 0;
    t = 0;
    while (!done && t < 40 * DIV) begin @(negedge clk); t++; end
    if (rx_data !== s || s_rx !== m || s_edges != 8 || !cs_n) begin
      errors++; if (errors < 10) $display("xfer m=%h s=%h: rx_data=%h slave got %h edges=%0d", m, s, rx_data, s_rx, s_edges);
    end
    if (sclk !== 0) begin errors++; $display("sclk not idle low"); end
    nxfer++;
    @(negedge clk);
    if (done !== 0 || busy !== 0) begin errors++; $display("done not a pulse"); end
  endtask

  initial begin
    last_edge = 0;
    #22;
    if (cs_n !== 1 || sclk !== 0 || busy !== 0) errors++;
    rst_n = 1;
    xfer(8'hA5, 8'h3C); xfer(8'h00, 8'hFF); xfer(8'hFF, 8'h00); xfer(8'h81, 8'h7E);
    for (int i = 0; i < 300; i++) begin
      xfer($random(seed), $random(seed));
      repeat ($random(seed) & 3) @(negedge clk);
    end
    if (errors == 0 && bad_period == 0 && nxfer == 304) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d bad_half_periods=%0d", errors, bad_period);
    $finish;
  end
endmodule

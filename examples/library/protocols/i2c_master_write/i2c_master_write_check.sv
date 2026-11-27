`timescale 1ns/1ps
module i2c_master_write_check;
  localparam int DIV = 2;
  localparam logic [6:0] MY_ADDR = 7'h52;
  logic       clk = 0, rst_n = 0, start = 0;
  logic [6:0] dev_addr = 0;
  logic [7:0] data = 0;
  logic       scl, sda_out, sda_oe, sda_in, busy, done, nack;
  int errors = 0, nok = 0, nnack = 0;
  integer seed = 32'h12C;

  // open-drain bus: pulled up, master drives when sda_oe, slave can only pull low
  logic slave_pull;
  wire  sda = (sda_oe ? sda_out : 1'b1) & !slave_pull;
  assign sda_in = sda;

  i2c_master_write #(.CLK_DIV(DIV)) dut (.clk(clk), .rst_n(rst_n), .start(start), .dev_addr(dev_addr),
    .data(data), .scl(scl), .sda_out(sda_out), .sda_oe(sda_oe), .sda_in(sda_in), .busy(busy), .done(done), .nack(nack));
  always #5 clk = ~clk;
  initial begin #5000000; $display("CHECK FAIL timeout"); $finish; end

  // ---------------- I2C slave model, oversampled at every clk ----------------
  logic       p_scl, p_sda;
  int         bitcnt, nbyte, starts, stops;
  bit         in_ack, data_ack_en;
  logic [7:0] sh, rx_addr, rx_data;
  always @(posedge clk) begin
    #1;
    if (rst_n) begin
      // while SCL is high the master must have released SDA whenever the slave pulls it (ACK slot)
      if (scl && slave_pull && sda_oe) begin errors++; $display("master drives SDA during ACK"); end
      if (p_scl && scl && p_sda && !sda) begin starts++; bitcnt = 0; nbyte = 0; in_ack = 0; end      // START
      else if (p_scl && scl && !p_sda && sda) begin stops++; end                                       // STOP
      else if (!p_scl && scl && !in_ack) begin sh = {sh[6:0], sda}; bitcnt++; end                     // sample
      else if (p_scl && !scl) begin                                                                    // SCL falls
        if (in_ack) begin slave_pull = 0; in_ack = 0; end
        else if (bitcnt == 8) begin
          bitcnt = 0; in_ack = 1;
          if (nbyte == 0) begin rx_addr = sh; slave_pull = (sh == {MY_ADDR, 1'b0}); end
          else begin rx_data = sh; slave_pull = data_ack_en; end
          nbyte++;
        end
      end
    end
    p_scl = scl; p_sda = sda;
  end
  // -----------------------------------------------------------------------------

  task automatic write_byte(input logic [6:0] a, input logic [7:0] d, input bit dack);
    int t, s0, p0; bit exp_nack;
    data_ack_en = dack;
    s0 = starts; p0 = stops;
    @(negedge clk); start = 1; dev_addr = a; data = d;
    @(negedge clk); start = 0; dev_addr = $random(seed); data = $random(seed);
    t = 0;
    while (!done && t < 200 * DIV) begin @(negedge clk); t++; end
    exp_nack = (a != MY_ADDR) || !dack;
    if (!done) begin errors++; $display("no done"); end
    if (nack !== exp_nack) begin errors++; $display("addr %h dack %b: nack=%b", a, dack, nack); end
    if (starts != s0 + 1 || stops != p0 + 1) begin errors++; $display("START/STOP count wrong"); end
    if (rx_addr !== {a, 1'b0}) begin errors++; $display("slave saw address byte %h", rx_addr); end
    if (a == MY_ADDR && rx_data !== d) begin errors++; $display("slave saw data %h exp %h", rx_data, d); end
    if (a != MY_ADDR && nbyte != 1) begin errors++; $display("data sent after address NACK"); end
    if (exp_nack) nnack++; else nok++;
    @(negedge clk);
    if (done || busy || !scl || !sda) begin errors++; $display("bus not idle after done"); end
  endtask

  initial begin
    slave_pull = 0; p_scl = 1; p_sda = 1; bitcnt = 0; nbyte = 0; starts = 0; stops = 0; in_ack = 0;
    rx_addr = 0; rx_data = 0; data_ack_en = 1;
    #22;
    if (scl !== 1 || sda_oe !== 0 || busy !== 0) errors++;
    rst_n = 1;
    write_byte(MY_ADDR, 8'hA5, 1);
    write_byte(MY_ADDR, 8'h00, 1);
    write_byte(7'h10, 8'hFF, 1);     // wrong address: NACK, STOP right after the address
    write_byte(MY_ADDR, 8'h3C, 0);   // data NACK
    for (int i = 0; i < 300; i++) begin
      logic [6:0] a;
      a = ($random(seed) & 3) == 0 ? 7'($random(seed)) : MY_ADDR;
      write_byte(a, $random(seed), ($random(seed) & 7) != 0);
      repeat ($random(seed) & 3) @(negedge clk);
    end
    if (errors == 0 && nok > 150 && nnack > 50) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d ok=%0d nack=%0d", errors, nok, nnack);
    $finish;
  end
endmodule

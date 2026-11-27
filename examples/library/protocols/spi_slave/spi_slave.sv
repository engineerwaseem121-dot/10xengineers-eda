// spi_slave: SPI mode 0 slave, oversampled by the system clock, MSB first
module spi_slave (
  input  logic       clk,
  input  logic       rst_n,
  // SPI bus (asynchronous to clk)
  input  logic       sclk,
  input  logic       cs_n,
  input  logic       mosi,
  output logic       miso,
  // user side
  input  logic [7:0] tx_data,      // byte to send; sampled when cs_n falls and after each byte
  output logic [7:0] rx_data,      // last byte received
  output logic       rx_valid      // one-cycle pulse when rx_data is updated
);
  // two-flop synchronizers plus one extra stage of sclk/cs_n for edge detection
  logic [2:0] sclk_sync, cs_sync;
  logic [1:0] mosi_sync;
  logic       sclk_rise, sclk_fall, cs_fall, selected;
  logic [7:0] rx_sh, tx_sh;
  logic [2:0] bit_cnt;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      sclk_sync <= 3'b000;
      cs_sync   <= 3'b111;
      mosi_sync <= 2'b00;
    end else begin
      sclk_sync <= {sclk_sync[1:0], sclk};
      cs_sync   <= {cs_sync[1:0], cs_n};
      mosi_sync <= {mosi_sync[0], mosi};
    end
  end

  assign sclk_rise = (sclk_sync[2:1] == 2'b01);
  assign sclk_fall = (sclk_sync[2:1] == 2'b10);
  assign cs_fall   = (cs_sync[2:1] == 2'b10);
  assign selected  = !cs_sync[1];

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      rx_sh    <= '0;
      tx_sh    <= '0;
      bit_cnt  <= '0;
      rx_data  <= '0;
      rx_valid <= 1'b0;
    end else begin
      rx_valid <= 1'b0;
      if (!selected) begin
        bit_cnt <= '0;
      end else if (cs_fall) begin
        tx_sh   <= tx_data;                    // first bit is presented before the first sclk edge
        bit_cnt <= '0;
      end else if (sclk_rise) begin
        rx_sh   <= {rx_sh[6:0], mosi_sync[1]};
        bit_cnt <= bit_cnt + 3'd1;
        if (bit_cnt == 3'd7) begin
          rx_data  <= {rx_sh[6:0], mosi_sync[1]};
          rx_valid <= 1'b1;
        end
      end else if (sclk_fall) begin
        if (bit_cnt == 3'd0) tx_sh <= tx_data; // byte finished: load the next one
        else                 tx_sh <= {tx_sh[6:0], 1'b0};
      end
    end
  end

  assign miso = selected ? tx_sh[7] : 1'b0;
endmodule

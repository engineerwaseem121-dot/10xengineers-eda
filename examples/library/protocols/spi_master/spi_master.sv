// spi_master: SPI mode 0 (CPOL=0, CPHA=0) master, one byte per transfer, MSB first
module spi_master #(
  parameter int CLK_DIV = 4            // clk cycles per sclk half period (>= 1)
) (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       start,            // begin a transfer (accepted only when idle)
  input  logic [7:0] tx_data,
  output logic [7:0] rx_data,          // byte received on miso (valid with done)
  output logic       done,             // one-cycle pulse at the end of a transfer
  output logic       busy,
  output logic       sclk,
  output logic       mosi,
  input  logic       miso,
  output logic       cs_n
);
  typedef enum logic [1:0] {IDLE, SCLK_LOW, SCLK_HIGH, FINISH} state_t;
  state_t      state;
  logic [15:0] div_cnt;
  logic [2:0]  bit_idx;
  logic [7:0]  tx_sh, rx_sh;
  logic        half_end;

  assign half_end = (div_cnt == 16'(CLK_DIV - 1));

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      state   <= IDLE;
      div_cnt <= '0;
      bit_idx <= '0;
      tx_sh   <= '0;
      rx_sh   <= '0;
      rx_data <= '0;
      done    <= 1'b0;
      sclk    <= 1'b0;
      cs_n    <= 1'b1;
    end else begin
      done <= 1'b0;
      case (state)
        IDLE: begin
          sclk    <= 1'b0;
          div_cnt <= '0;
          bit_idx <= '0;
          if (start) begin
            tx_sh <= tx_data;          // bit 7 appears on mosi as cs_n falls
            cs_n  <= 1'b0;
            state <= SCLK_LOW;
          end
        end
        SCLK_LOW: begin
          if (half_end) begin
            div_cnt <= '0;
            sclk    <= 1'b1;           // rising edge: both sides sample
            rx_sh   <= {rx_sh[6:0], miso};
            state   <= SCLK_HIGH;
          end else div_cnt <= div_cnt + 16'd1;
        end
        SCLK_HIGH: begin
          if (half_end) begin
            div_cnt <= '0;
            sclk    <= 1'b0;           // falling edge: next bit is shifted out
            if (bit_idx == 3'd7) begin
              state <= FINISH;
            end else begin
              bit_idx <= bit_idx + 3'd1;
              tx_sh   <= {tx_sh[6:0], 1'b0};
              state   <= SCLK_LOW;
            end
          end else div_cnt <= div_cnt + 16'd1;
        end
        FINISH: begin
          if (half_end) begin          // hold cs_n low for half a period after the last edge
            div_cnt <= '0;
            cs_n    <= 1'b1;
            rx_data <= rx_sh;
            done    <= 1'b1;
            state   <= IDLE;
          end else div_cnt <= div_cnt + 16'd1;
        end
        default: state <= IDLE;
      endcase
    end
  end

  assign mosi = tx_sh[7];
  assign busy = (state != IDLE);
endmodule

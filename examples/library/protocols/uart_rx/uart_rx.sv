// uart_rx: 8N1 UART receiver with input synchronizer, mid-bit sampling and framing-error detection
module uart_rx #(
  parameter int CLKS_PER_BIT = 868     // clock cycles per bit, must match the transmitter
) (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       rx,               // asynchronous serial input, idle high
  output logic [7:0] rx_data,
  output logic       rx_valid,         // one-cycle pulse: rx_data holds a good byte
  output logic       framing_error     // one-cycle pulse: stop bit was 0
);
  typedef enum logic [2:0] {IDLE, START, DATA, STOP, WAIT_HIGH} state_t;
  state_t      state;
  logic        rx_meta, rx_s;          // two-flop synchronizer
  logic [15:0] clk_cnt;
  logic [2:0]  bit_idx;
  logic [7:0]  shreg;
  logic        half_bit, full_bit;

  assign half_bit = (clk_cnt == 16'(CLKS_PER_BIT / 2 - 1));
  assign full_bit = (clk_cnt == 16'(CLKS_PER_BIT - 1));

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      rx_meta <= 1'b1;
      rx_s    <= 1'b1;
    end else begin
      rx_meta <= rx;
      rx_s    <= rx_meta;
    end
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      state         <= IDLE;
      clk_cnt       <= '0;
      bit_idx       <= '0;
      shreg         <= '0;
      rx_data       <= '0;
      rx_valid      <= 1'b0;
      framing_error <= 1'b0;
    end else begin
      rx_valid      <= 1'b0;
      framing_error <= 1'b0;
      case (state)
        IDLE: begin
          clk_cnt <= '0;
          bit_idx <= '0;
          if (!rx_s) state <= START;               // falling edge of the start bit
        end
        START: begin                               // wait to the middle of the start bit
          if (half_bit) begin
            clk_cnt <= '0;
            if (!rx_s) state <= DATA;              // still low: valid start bit
            else       state <= IDLE;              // glitch: ignore
          end else clk_cnt <= clk_cnt + 16'd1;
        end
        DATA: begin                                // sample in the middle of each data bit
          if (full_bit) begin
            clk_cnt <= '0;
            shreg   <= {rx_s, shreg[7:1]};         // LSB first
            if (bit_idx == 3'd7) state <= STOP;
            else bit_idx <= bit_idx + 3'd1;
          end else clk_cnt <= clk_cnt + 16'd1;
        end
        STOP: begin                                // middle of the stop bit
          if (full_bit) begin
            clk_cnt <= '0;
            rx_data <= shreg;
            if (rx_s) begin
              rx_valid <= 1'b1;
              state    <= IDLE;
            end else begin
              framing_error <= 1'b1;
              state         <= WAIT_HIGH;
            end
          end else clk_cnt <= clk_cnt + 16'd1;
        end
        WAIT_HIGH: if (rx_s) state <= IDLE;        // wait for the line to return to idle
        default: state <= IDLE;
      endcase
    end
  end
endmodule

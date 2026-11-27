// uart_tx: 8N1 UART transmitter (1 start bit, 8 data bits LSB first, 1 stop bit)
module uart_tx #(
  parameter int CLKS_PER_BIT = 868     // clock cycles per bit, e.g. 100 MHz / 115200
) (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       tx_start,         // start sending tx_data (accepted only when idle)
  input  logic [7:0] tx_data,
  output logic       tx,               // serial line, idle high
  output logic       tx_busy,
  output logic       tx_done           // one-cycle pulse after the stop bit
);
  typedef enum logic [1:0] {IDLE, START, DATA, STOP} state_t;
  state_t      state;
  logic [15:0] clk_cnt;
  logic [2:0]  bit_idx;
  logic [7:0]  shreg;
  logic        bit_end;

  assign bit_end = (clk_cnt == 16'(CLKS_PER_BIT - 1));

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      state   <= IDLE;
      clk_cnt <= '0;
      bit_idx <= '0;
      shreg   <= '0;
      tx_done <= 1'b0;
    end else begin
      tx_done <= 1'b0;
      case (state)
        IDLE: begin
          clk_cnt <= '0;
          bit_idx <= '0;
          if (tx_start) begin
            shreg <= tx_data;
            state <= START;
          end
        end
        START: begin
          if (bit_end) begin
            clk_cnt <= '0;
            state   <= DATA;
          end else clk_cnt <= clk_cnt + 16'd1;
        end
        DATA: begin
          if (bit_end) begin
            clk_cnt <= '0;
            shreg   <= shreg >> 1;
            if (bit_idx == 3'd7) state <= STOP;
            else bit_idx <= bit_idx + 3'd1;
          end else clk_cnt <= clk_cnt + 16'd1;
        end
        STOP: begin
          if (bit_end) begin
            clk_cnt <= '0;
            tx_done <= 1'b1;
            state   <= IDLE;
          end else clk_cnt <= clk_cnt + 16'd1;
        end
        default: state <= IDLE;
      endcase
    end
  end

  // line value: start bit 0, data LSB first, idle and stop bit 1
  assign tx = (state == START) ? 1'b0 :
              (state == DATA)  ? shreg[0] : 1'b1;

  assign tx_busy = (state != IDLE);
endmodule

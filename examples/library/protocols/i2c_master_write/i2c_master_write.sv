// i2c_master_write: simplified I2C master that writes one data byte to a 7-bit device address
// Sequence: START, address + W, ACK, data, ACK, STOP. SDA is modelled as output + output-enable.
module i2c_master_write #(
  parameter int CLK_DIV = 125          // clk cycles per quarter SCL period (50 MHz -> 100 kHz)
) (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       start,            // begin a write (accepted only when idle)
  input  logic [6:0] dev_addr,
  input  logic [7:0] data,
  output logic       scl,
  output logic       sda_out,          // value driven on SDA when sda_oe = 1
  output logic       sda_oe,           // 1: master drives SDA, 0: released (pulled up)
  input  logic       sda_in,           // SDA line as seen on the bus
  output logic       busy,
  output logic       done,             // one-cycle pulse when the STOP condition has finished
  output logic       nack              // last write was not acknowledged (valid with done)
);
  typedef enum logic [2:0] {IDLE, START, ADDR, ADDR_ACK, DATA, DATA_ACK, STOP} state_t;
  state_t      state;
  logic [15:0] div_cnt;
  logic [1:0]  phase;                  // quarter of the current SCL period
  logic [2:0]  bit_idx;
  logic [7:0]  shreg;
  logic [7:0]  data_q;
  logic        ack_bit;                // SDA sampled in the middle of an ACK slot
  logic        tick, slot_end;
  logic        cur_bit;                // bit being sent (MSB of the shift register)

  assign tick     = (div_cnt == 16'(CLK_DIV - 1));
  assign cur_bit  = shreg[7];
  assign slot_end = tick && (phase == 2'd3);

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      state   <= IDLE;
      div_cnt <= '0;
      phase   <= '0;
      bit_idx <= '0;
      shreg   <= '0;
      data_q  <= '0;
      ack_bit <= 1'b0;
      done    <= 1'b0;
      nack    <= 1'b0;
    end else begin
      done <= 1'b0;
      if (state == IDLE) begin
        div_cnt <= '0;
        phase   <= '0;
        if (start) begin
          shreg  <= {dev_addr, 1'b0};  // R/W bit = 0 (write)
          data_q <= data;
          nack   <= 1'b0;
          state  <= START;
        end
      end else begin
        div_cnt <= tick ? 16'd0 : div_cnt + 16'd1;
        if (tick) phase <= phase + 2'd1;
        if (tick && phase == 2'd1 && (state == ADDR_ACK || state == DATA_ACK))
          ack_bit <= sda_in;           // SCL is high: read the slave's answer
        if (slot_end) begin
          case (state)
            START: begin
              bit_idx <= 3'd7;
              state   <= ADDR;
            end
            ADDR, DATA: begin
              if (bit_idx == 3'd0) begin
                if (state == ADDR) state <= ADDR_ACK;
                else               state <= DATA_ACK;
              end else begin
                bit_idx <= bit_idx - 3'd1;
                shreg   <= {shreg[6:0], 1'b0};
              end
            end
            ADDR_ACK: begin
              if (ack_bit) begin       // no device answered
                nack  <= 1'b1;
                state <= STOP;
              end else begin
                shreg   <= data_q;
                bit_idx <= 3'd7;
                state   <= DATA;
              end
            end
            DATA_ACK: begin
              nack  <= ack_bit;
              state <= STOP;
            end
            STOP: begin
              done  <= 1'b1;
              state <= IDLE;
            end
            default: state <= IDLE;
          endcase
        end
      end
    end
  end

  // bus outputs decoded from state and quarter phase
  always_comb begin
    scl     = 1'b1;
    sda_oe  = 1'b0;
    sda_out = 1'b1;
    case (state)
      START: begin                     // SDA falls while SCL is high, then SCL falls
        sda_oe  = 1'b1;
        sda_out = (phase == 2'd0);
        scl     = (phase != 2'd3);
      end
      ADDR, DATA: begin                // SDA changes while SCL is low (phase 0)
        sda_oe  = 1'b1;
        sda_out = cur_bit;
        scl     = (phase == 2'd1) || (phase == 2'd2);
      end
      ADDR_ACK, DATA_ACK: begin        // SDA released for the slave
        sda_oe  = 1'b0;
        scl     = (phase == 2'd1) || (phase == 2'd2);
      end
      STOP: begin                      // SDA low, SCL rises, then SDA rises while SCL is high
        sda_oe  = 1'b1;
        sda_out = (phase >= 2'd2);
        scl     = (phase != 2'd0);
      end
      default: ;                       // IDLE: bus released, SCL high
    endcase
  end

  assign busy = (state != IDLE);
endmodule

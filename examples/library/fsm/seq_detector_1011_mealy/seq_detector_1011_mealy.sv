// seq_detector_1011_mealy: overlapping "1011" detector, Mealy output
module seq_detector_1011_mealy (
  input  logic clk,
  input  logic rst_n,
  input  logic din,
  output logic detected
);
  typedef enum logic [1:0] {S_IDLE, S_1, S_10, S_101} state_t;
  state_t state, next_state;

  always_comb begin
    next_state = state;
    detected   = 1'b0;
    case (state)
      S_IDLE: if (din) next_state = S_1; else next_state = S_IDLE;
      S_1:    if (din) next_state = S_1; else next_state = S_10;
      S_10:   if (din) next_state = S_101; else next_state = S_IDLE;
      S_101: begin
        if (din) begin
          next_state = S_1;
          detected   = 1'b1;
        end else begin
          next_state = S_10;
        end
      end
      default: next_state = S_IDLE;
    endcase
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) state <= S_IDLE;
    else        state <= next_state;
  end
endmodule

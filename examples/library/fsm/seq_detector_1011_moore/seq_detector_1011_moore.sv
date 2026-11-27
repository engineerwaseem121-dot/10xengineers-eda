// seq_detector_1011_moore: overlapping "1011" detector, Moore output
module seq_detector_1011_moore (
  input  logic clk,
  input  logic rst_n,
  input  logic din,
  output logic detected
);
  typedef enum logic [2:0] {S_IDLE, S_1, S_10, S_101, S_1011} state_t;
  state_t state, next_state;

  always_comb begin
    next_state = state;
    case (state)
      S_IDLE:  if (din) next_state = S_1; else next_state = S_IDLE;
      S_1:     if (din) next_state = S_1; else next_state = S_10;
      S_10:    if (din) next_state = S_101; else next_state = S_IDLE;
      S_101:   if (din) next_state = S_1011; else next_state = S_10;
      S_1011:  if (din) next_state = S_1; else next_state = S_10;
      default: next_state = S_IDLE;
    endcase
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) state <= S_IDLE;
    else        state <= next_state;
  end

  assign detected = (state == S_1011);
endmodule

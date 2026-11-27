// handshake_ctrl: initiator side of a four-phase (return-to-zero) req/ack handshake
module handshake_ctrl (
  input  logic clk,
  input  logic rst_n,
  input  logic start,   // request a transfer (sampled in IDLE)
  input  logic ack,     // acknowledge from the responder
  output logic req,     // request to the responder
  output logic busy,    // a handshake is in progress
  output logic done     // one-cycle pulse when the handshake has completed
);
  typedef enum logic [1:0] {IDLE, REQ_HIGH, REQ_LOW, DONE} state_t;
  state_t state, next_state;

  always_comb begin
    next_state = state;
    case (state)
      IDLE:     if (start) next_state = REQ_HIGH;
      REQ_HIGH: if (ack)   next_state = REQ_LOW;   // phase 1-2: req up, wait ack up
      REQ_LOW:  if (!ack)  next_state = DONE;      // phase 3-4: req down, wait ack down
      DONE:     next_state = IDLE;
      default:  next_state = IDLE;
    endcase
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) state <= IDLE;
    else        state <= next_state;
  end

  assign req  = (state == REQ_HIGH);
  assign busy = (state != IDLE);
  assign done = (state == DONE);
endmodule

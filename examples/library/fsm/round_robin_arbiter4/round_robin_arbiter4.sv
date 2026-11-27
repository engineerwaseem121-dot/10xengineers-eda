// round_robin_arbiter4: 4-requester round-robin arbiter, registered one-hot grant
module round_robin_arbiter4 (
  input  logic       clk,
  input  logic       rst_n,
  input  logic [3:0] req,
  output logic [3:0] grant
);
  typedef enum logic [2:0] {IDLE, G0, G1, G2, G3} state_t;
  state_t     state, next_state;
  logic [1:0] last;       // index of the most recent grant (kept through IDLE)
  logic [1:0] base;       // search starts at base + 1
  logic [1:0] winner;
  logic       found;

  always_comb begin
    case (state)
      G0:      base = 2'd0;
      G1:      base = 2'd1;
      G2:      base = 2'd2;
      G3:      base = 2'd3;
      default: base = last;   // IDLE: remember who was served last
    endcase
  end

  // first requester after base, wrapping around (base itself is checked last)
  always_comb begin
    found  = 1'b0;
    winner = base;
    for (int k = 1; k <= 4; k++) begin
      if (!found && req[2'(base + k)]) begin
        found  = 1'b1;
        winner = 2'(base + k);
      end
    end
  end

  always_comb begin
    if (!found) next_state = IDLE;
    else begin
      case (winner)
        2'd0:    next_state = G0;
        2'd1:    next_state = G1;
        2'd2:    next_state = G2;
        default: next_state = G3;
      endcase
    end
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      state <= IDLE;
      last  <= 2'd3;          // requester 0 has the highest priority after reset
    end else begin
      state <= next_state;
      if (found) last <= winner;
    end
  end

  always_comb begin
    case (state)
      G0:      grant = 4'b0001;
      G1:      grant = 4'b0010;
      G2:      grant = 4'b0100;
      G3:      grant = 4'b1000;
      default: grant = 4'b0000;
    endcase
  end
endmodule

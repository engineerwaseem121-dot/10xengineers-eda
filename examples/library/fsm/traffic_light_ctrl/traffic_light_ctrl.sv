// traffic_light_ctrl: two-way (north-south / east-west) traffic light controller
module traffic_light_ctrl #(
  parameter int GREEN_TIME  = 8,   // cycles a direction stays green
  parameter int YELLOW_TIME = 2    // cycles a direction stays yellow
) (
  input  logic clk,
  input  logic rst_n,
  output logic ns_red,
  output logic ns_yellow,
  output logic ns_green,
  output logic ew_red,
  output logic ew_yellow,
  output logic ew_green
);
  typedef enum logic [1:0] {NS_GREEN, NS_YELLOW, EW_GREEN, EW_YELLOW} state_t;

  state_t      state, next_state;
  logic [7:0]  timer;
  logic        last;   // high on the final cycle of the current state

  always_comb begin
    case (state)
      NS_GREEN, EW_GREEN: last = (timer == 8'(GREEN_TIME - 1));
      default:            last = (timer == 8'(YELLOW_TIME - 1));
    endcase
  end

  always_comb begin
    next_state = state;
    case (state)
      NS_GREEN:  if (last) next_state = NS_YELLOW;
      NS_YELLOW: if (last) next_state = EW_GREEN;
      EW_GREEN:  if (last) next_state = EW_YELLOW;
      EW_YELLOW: if (last) next_state = NS_GREEN;
      default:   next_state = NS_GREEN;
    endcase
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      state <= NS_GREEN;
      timer <= '0;
    end else begin
      state <= next_state;
      timer <= last ? 8'd0 : timer + 8'd1;
    end
  end

  assign ns_green  = (state == NS_GREEN);
  assign ns_yellow = (state == NS_YELLOW);
  assign ns_red    = (state == EW_GREEN) || (state == EW_YELLOW);
  assign ew_green  = (state == EW_GREEN);
  assign ew_yellow = (state == EW_YELLOW);
  assign ew_red    = (state == NS_GREEN) || (state == NS_YELLOW);
endmodule

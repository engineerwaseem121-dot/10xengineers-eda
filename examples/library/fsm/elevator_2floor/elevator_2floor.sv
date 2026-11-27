// elevator_2floor: two-floor elevator controller with latched calls, door and motor control
module elevator_2floor #(
  parameter int DOOR_TIME   = 4,   // cycles the door stays open
  parameter int TRAVEL_TIME = 8    // cycles to travel between floors
) (
  input  logic clk,
  input  logic rst_n,
  input  logic call0,       // call button for floor 0
  input  logic call1,       // call button for floor 1
  output logic floor,       // floor the car is at / leaving (0 or 1)
  output logic door_open,
  output logic motor_up,
  output logic motor_down
);
  typedef enum logic [2:0] {IDLE0, DOOR0, UP, IDLE1, DOOR1, DOWN} state_t;
  state_t     state, next_state;
  logic [7:0] timer;
  logic       pend0, pend1;      // latched calls
  logic       want0, want1;      // latched or new call
  logic       door_end, travel_end;

  assign want0      = pend0 | call0;
  assign want1      = pend1 | call1;
  assign door_end   = (timer == 8'(DOOR_TIME - 1));
  assign travel_end = (timer == 8'(TRAVEL_TIME - 1));

  always_comb begin
    next_state = state;
    case (state)
      IDLE0: begin
        if (want0)      next_state = DOOR0;
        else if (want1) next_state = UP;
      end
      DOOR0: if (door_end)   next_state = IDLE0;
      UP:    if (travel_end) next_state = DOOR1;
      IDLE1: begin
        if (want1)      next_state = DOOR1;
        else if (want0) next_state = DOWN;
      end
      DOOR1: if (door_end)   next_state = IDLE1;
      DOWN:  if (travel_end) next_state = DOOR0;
      default: next_state = IDLE0;
    endcase
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      state <= IDLE0;
      timer <= '0;
      pend0 <= 1'b0;
      pend1 <= 1'b0;
    end else begin
      state <= next_state;
      timer <= (next_state != state) ? 8'd0 : timer + 8'd1;
      // a call is served (cleared) when the door opens or is open at that floor
      pend0 <= want0 & (next_state != DOOR0);
      pend1 <= want1 & (next_state != DOOR1);
    end
  end

  assign door_open  = (state == DOOR0) || (state == DOOR1);
  assign motor_up   = (state == UP);
  assign motor_down = (state == DOWN);
  assign floor      = (state == IDLE1) || (state == DOOR1) || (state == DOWN);
endmodule

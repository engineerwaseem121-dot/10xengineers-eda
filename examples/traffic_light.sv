// Example design for 10xEngineers EDA: open this file and click "Show FSM Diagram",
// then open traffic_light.vcd to see FSM decoding + coverage in the waveform.
module traffic_light (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       car_waiting,
  input  logic       emergency,
  output logic [2:0] main_light,   // {red, yellow, green}
  output logic [2:0] side_light
);

  typedef enum logic [2:0] {
    MAIN_GREEN  = 3'd0,
    MAIN_YELLOW = 3'd1,
    ALL_RED     = 3'd2,
    SIDE_GREEN  = 3'd3,
    SIDE_YELLOW = 3'd4,
    FLASH       = 3'd5
  } state_t;

  state_t     state, next_state;
  logic [3:0] timer;

  // state register
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) state <= MAIN_GREEN;
    else        state <= next_state;
  end

  // time-in-state counter
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)                   timer <= '0;
    else if (state != next_state) timer <= '0;
    else if (timer != 4'hF)       timer <= timer + 4'd1;
  end

  // next-state logic
  always_comb begin
    next_state = state;
    unique case (state)
      MAIN_GREEN:  if (emergency) next_state = FLASH;
                   else if (car_waiting && timer >= 4'd5) next_state = MAIN_YELLOW;
      MAIN_YELLOW: if (timer >= 4'd2) next_state = ALL_RED;
      ALL_RED:     next_state = (timer >= 4'd1) ? SIDE_GREEN : ALL_RED;
      SIDE_GREEN:  if (timer >= 4'd4) next_state = SIDE_YELLOW;
      SIDE_YELLOW: if (timer >= 4'd2) next_state = MAIN_GREEN;
      FLASH:       if (!emergency) next_state = ALL_RED;
      default:     next_state = MAIN_GREEN;
    endcase
  end

  // outputs
  always_comb begin
    main_light = 3'b100;
    side_light = 3'b100;
    case (state)
      MAIN_GREEN:  main_light = 3'b001;
      MAIN_YELLOW: main_light = 3'b010;
      SIDE_GREEN:  side_light = 3'b001;
      SIDE_YELLOW: side_light = 3'b010;
      FLASH: begin
        main_light = 3'b010;
        side_light = 3'b010;
      end
      default: ;
    endcase
  end

endmodule

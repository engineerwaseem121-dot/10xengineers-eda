// vending_machine: accepts 5 and 10 coins, vends an item priced 15, returns 5 change on overpay
module vending_machine (
  input  logic clk,
  input  logic rst_n,
  input  logic coin5,    // a 5 coin is inserted this cycle
  input  logic coin10,   // a 10 coin is inserted this cycle
  output logic vend,     // item dispensed (one-cycle pulse)
  output logic change    // 5 change returned (one-cycle pulse, together with vend)
);
  typedef enum logic [2:0] {S_0, S_5, S_10, S_VEND, S_VEND_CHG} state_t;
  state_t state, next_state;

  logic c5, c10;
  // both coins in the same cycle is not a legal input: neither is accepted
  assign c5  = coin5  & ~coin10;
  assign c10 = coin10 & ~coin5;

  always_comb begin
    next_state = state;
    case (state)
      S_0, S_VEND, S_VEND_CHG: begin   // no credit held
        if (c5)       next_state = S_5;
        else if (c10) next_state = S_10;
        else          next_state = S_0;
      end
      S_5: begin
        if (c5)       next_state = S_10;
        else if (c10) next_state = S_VEND;
      end
      S_10: begin
        if (c5)       next_state = S_VEND;
        else if (c10) next_state = S_VEND_CHG;
      end
      default: next_state = S_0;
    endcase
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) state <= S_0;
    else        state <= next_state;
  end

  assign vend   = (state == S_VEND) || (state == S_VEND_CHG);
  assign change = (state == S_VEND_CHG);
endmodule

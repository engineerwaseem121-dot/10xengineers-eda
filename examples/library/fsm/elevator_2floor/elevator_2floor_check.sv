`timescale 1ns/1ps
module elevator_2floor_check;
  localparam int DT = 3, TT = 5;
  logic clk = 0, rst_n = 0, call0 = 0, call1 = 0;
  logic floor, door_open, motor_up, motor_down;
  int errors = 0, trips = 0;
  integer seed = 32'd77;

  elevator_2floor #(.DOOR_TIME(DT), .TRAVEL_TIME(TT)) dut (
    .clk(clk), .rst_n(rst_n), .call0(call0), .call1(call1),
    .floor(floor), .door_open(door_open), .motor_up(motor_up), .motor_down(motor_down));
  always #5 clk = ~clk;
  initial begin #3000000; $display("CHECK FAIL timeout"); $finish; end

  // independent model: position (0/1), activity (0 idle, 1 door, 2 moving), remaining cycles
  int pos, act, left;
  bit p0, p1;

  task automatic step(input logic c0, input logic c1);
    bit w0, w1;
    logic [3:0] exp, got;
    @(negedge clk) begin call0 = c0; call1 = c1; end
    @(posedge clk);
    w0 = p0 | c0; w1 = p1 | c1;
    if (act == 0) begin
      if ((pos == 0 && w0) || (pos == 1 && w1)) begin act = 1; left = DT; end
      else if (pos == 0 && w1) begin act = 2; left = TT; end
      else if (pos == 1 && w0) begin act = 2; left = TT; end
    end else begin
      left--;
      if (left == 0) begin
        if (act == 1) act = 0;
        else begin pos = 1 - pos; act = 1; left = DT; trips++; end
      end
    end
    // clear the call of the floor whose door is open now
    p0 = w0 && !(act == 1 && pos == 0);
    p1 = w1 && !(act == 1 && pos == 1);
    #1;
    // floor output: during travel shows the floor being left
    exp = {(act == 2) ? (pos == 1) : (pos == 1), act == 1, act == 2 && pos == 0, act == 2 && pos == 1};
    got = {floor, door_open, motor_up, motor_down};
    if (got !== exp) begin
      errors++;
      if (errors < 10) $display("mismatch t=%0t got %b exp %b (pos=%0d act=%0d left=%0d)", $time, got, exp, pos, act, left);
    end
  endtask

  initial begin
    pos = 0; act = 0; left = 0; p0 = 0; p1 = 0;
    #12; if ({floor, door_open, motor_up, motor_down} !== 4'b0000) errors++;
    @(negedge clk) rst_n = 1;
    step(0,1); repeat (12) step(0,0);       // go up, open door, close
    step(1,0); step(0,0); step(1,0); repeat (12) step(0,0);  // come down (second press merged)
    step(1,1); repeat (25) step(0,0);       // both: open here first, then go up
    for (int i = 0; i < 6000; i++) begin
      int r; r = $random(seed) & 15;
      step(r == 0, r == 1 || r == 2);
    end
    if (errors == 0 && trips > 50) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d trips=%0d", errors, trips);
    $finish;
  end
endmodule

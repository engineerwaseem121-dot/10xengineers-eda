`timescale 1ns/1ps
module pwm_gen_check;
  logic clk = 0, rst_n = 0, pwm;
  logic [7:0] duty = 0;
  int errors = 0;
  integer seed = 32'h9A;

  pwm_gen dut (.clk(clk), .rst_n(rst_n), .duty(duty), .pwm(pwm));
  always #5 clk = ~clk;
  initial begin #20000000; $display("CHECK FAIL timeout"); $finish; end

  // independent model: position in period and duty latched at period start
  int pos, mduty, high_cnt, mduty_prev;

  task automatic run_period(input logic [7:0] next_duty);
    high_cnt = 0;
    for (int i = 0; i < 256; i++) begin
      if (i == 100) duty = next_duty;    // changes mid-period must not affect this period
      if (pwm !== (pos < mduty)) begin
        errors++; if (errors < 10) $display("mismatch pos=%0d duty=%0d pwm=%b", pos, mduty, pwm);
      end
      if (pwm) high_cnt++;
      @(posedge clk);
      if (pos == 255) begin pos = 0; mduty = duty; end else pos++;
      @(negedge clk);
    end
    if (high_cnt != mduty_prev) begin errors++; $display("high count %0d exp %0d", high_cnt, mduty_prev); end
  endtask


  initial begin
    pos = 0; mduty = 0;
    #12; if (pwm !== 0) errors++;
    @(negedge clk) duty = 8'd0; rst_n = 1;
    // first period after reset: duty_q = 0
    mduty_prev = 0; run_period(8'd128);
    mduty_prev = mduty; run_period(8'd255);
    mduty_prev = mduty; run_period(8'd1);
    mduty_prev = mduty; run_period(8'd0);
    mduty_prev = mduty; run_period(8'd64);
    for (int k = 0; k < 40; k++) begin
      mduty_prev = mduty; run_period($random(seed));
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d", errors);
    $finish;
  end
endmodule

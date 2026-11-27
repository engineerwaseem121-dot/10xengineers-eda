`timescale 1ns/1ps
module handshake_ctrl_check;
  logic clk = 0, rst_n = 0, start = 0, ack = 0;
  logic req, busy, done;
  int errors = 0, ndone = 0;
  integer seed = 32'd4;
  // responder: random delays before raising / lowering ack
  int dly;

  handshake_ctrl dut (.clk(clk), .rst_n(rst_n), .start(start), .ack(ack), .req(req), .busy(busy), .done(done));
  always #5 clk = ~clk;
  initial begin #2000000; $display("CHECK FAIL timeout"); $finish; end

  // independent model of the initiator: phase 0 idle, 1 req high, 2 req low, 3 done
  int ph;
  logic prev_req, prev_ack, a_s;
  always @(posedge clk) begin
    if (rst_n) begin
      a_s = ack;
      case (ph)
        0: if (start) ph = 1;
        1: if (ack) ph = 2;
        2: if (!ack) ph = 3;
        3: ph = 0;
      endcase
      #1;
      if (req !== (ph == 1) || busy !== (ph != 0) || done !== (ph == 3)) begin
        errors++;
        if (errors < 10) $display("mismatch ph=%0d req=%b busy=%b done=%b", ph, req, busy, done);
      end
      // protocol: req may only rise while ack low, and may only fall after ack high
      if (req && !prev_req && a_s) begin errors++; $display("req rose while ack high"); end
      if (!req && prev_req && !a_s) begin errors++; $display("req fell before ack"); end
      if (done) ndone++;
      prev_req = req; prev_ack = ack;
    end
  end

  // responder process (drives ack on negedge)
  initial begin
    forever begin
      @(negedge clk);
      if (req && !ack) begin
        dly = $random(seed) & 3;
        repeat (dly) @(negedge clk);
        ack = 1;
      end else if (!req && ack) begin
        dly = $random(seed) & 3;
        repeat (dly) @(negedge clk);
        ack = 0;
      end
    end
  end

  initial begin
    ph = 0; prev_req = 0; prev_ack = 0;
    #12; if (req !== 0 || busy !== 0 || done !== 0) errors++;
    @(negedge clk) rst_n = 1;
    @(negedge clk) start = 1;
    @(negedge clk) start = 0;
    repeat (20) @(negedge clk);
    for (int i = 0; i < 3000; i++) begin
      @(negedge clk) start = ($random(seed) & 3) == 0;
    end
    start = 0;
    repeat (30) @(negedge clk);
    if (errors == 0 && ndone > 100) $display("CHECK PASS");
    else $display("CHECK FAIL errors=%0d handshakes=%0d", errors, ndone);
    $finish;
  end
endmodule

// debouncer: output follows input only after the input has differed from it for STABLE_CYCLES samples
module debouncer #(
  parameter int STABLE_CYCLES = 4
) (
  input  logic clk,
  input  logic rst_n,
  input  logic din,
  output logic dout
);
  localparam int CW = (STABLE_CYCLES > 1) ? $clog2(STABLE_CYCLES) : 1;
  logic [CW-1:0] cnt;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      cnt  <= '0;
      dout <= 1'b0;
    end else if (din == dout) begin
      cnt  <= '0;
    end else if (cnt == CW'(STABLE_CYCLES - 1)) begin
      cnt  <= '0;
      dout <= din;
    end else begin
      cnt  <= cnt + 1'b1;
    end
  end
endmodule

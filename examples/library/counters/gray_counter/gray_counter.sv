// gray_counter: WIDTH-bit counter with Gray-coded output
module gray_counter #(
  parameter int WIDTH = 4
) (
  input  logic             clk,
  input  logic             rst_n,
  input  logic             en,
  output logic [WIDTH-1:0] gray
);
  logic [WIDTH-1:0] bin;
  logic [WIDTH-1:0] bin_next;

  assign bin_next = bin + 1'b1;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      bin  <= '0;
      gray <= '0;
    end else if (en) begin
      bin  <= bin_next;
      gray <= bin_next ^ (bin_next >> 1);
    end
  end
endmodule

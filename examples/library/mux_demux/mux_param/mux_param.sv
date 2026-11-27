// mux_param: N-to-1 multiplexer with WIDTH-bit inputs packed in in_data
//   input k occupies in_data[k*WIDTH +: WIDTH]; sel >= N gives y = 0
module mux_param #(
  parameter int N     = 4,
  parameter int WIDTH = 8,
  parameter int SEL_W = (N > 1) ? $clog2(N) : 1
) (
  input  logic [N*WIDTH-1:0] in_data,
  input  logic [SEL_W-1:0]   sel,
  output logic [WIDTH-1:0]   y
);
  always_comb begin
    y = '0;
    for (int k = 0; k < N; k++) begin
      if (sel == k[SEL_W-1:0])
        y = in_data[k*WIDTH +: WIDTH];
    end
  end
endmodule

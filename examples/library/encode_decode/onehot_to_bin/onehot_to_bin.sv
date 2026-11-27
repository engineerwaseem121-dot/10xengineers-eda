// onehot_to_bin: N-bit one-hot vector -> $clog2(N)-bit binary index
module onehot_to_bin #(
  parameter int N = 8
) (
  input  logic [N-1:0]         onehot,
  output logic [$clog2(N)-1:0] bin
);
  localparam int W = $clog2(N);

  always_comb begin
    bin = '0;
    for (int i = 0; i < N; i++) begin
      if (onehot[i]) bin = bin | W'(i);
    end
  end
endmodule

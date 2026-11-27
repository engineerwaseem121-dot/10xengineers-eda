// and_n: N-input AND gate (AND reduction of an N-bit input vector)
module and_n #(
  parameter int N = 4
) (
  input  logic [N-1:0] a,
  output logic         y
);
  assign y = &a;
endmodule

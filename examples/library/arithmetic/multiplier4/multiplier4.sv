// multiplier4: unsigned WIDTH x WIDTH (default 4x4) combinational multiplier
// built as a sum of shifted partial products (array multiplier)
module multiplier4 #(
  parameter int WIDTH = 4
) (
  input  logic [WIDTH-1:0]   a,
  input  logic [WIDTH-1:0]   b,
  output logic [2*WIDTH-1:0] product
);
  logic [2*WIDTH-1:0] acc;

  always_comb begin
    acc = '0;
    for (int i = 0; i < WIDTH; i++) begin
      if (b[i])
        acc = acc + ({{WIDTH{1'b0}}, a} << i);
    end
    product = acc;
  end
endmodule

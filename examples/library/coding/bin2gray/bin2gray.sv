// bin2gray: binary -> reflected Gray code
module bin2gray #(
  parameter int WIDTH = 8
) (
  input  logic [WIDTH-1:0] bin,
  output logic [WIDTH-1:0] gray
);
  assign gray = bin ^ (bin >> 1);
endmodule

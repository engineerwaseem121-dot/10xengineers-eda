// d_latch: level-sensitive D latch, transparent while en = 1
module d_latch (
  input  logic en,
  input  logic d,
  output logic q
);
  always_latch begin
    if (en) q = d;
  end
endmodule

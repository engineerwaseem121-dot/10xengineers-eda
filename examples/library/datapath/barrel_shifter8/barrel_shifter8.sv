// barrel_shifter8: 8-bit logical barrel shifter, 3 log stages
module barrel_shifter8 (
  input  logic [7:0] data,
  input  logic [2:0] shamt,
  input  logic       dir,     // 0 = left, 1 = right
  output logic [7:0] dout
);
  logic [7:0] s1, s2;

  always_comb begin
    if (dir == 1'b0) begin
      s1   = shamt[0] ? {data[6:0], 1'b0}  : data;
      s2   = shamt[1] ? {s1[5:0],   2'b0}  : s1;
      dout = shamt[2] ? {s2[3:0],   4'b0}  : s2;
    end else begin
      s1   = shamt[0] ? {1'b0, data[7:1]}  : data;
      s2   = shamt[1] ? {2'b0, s1[7:2]}    : s1;
      dout = shamt[2] ? {4'b0, s2[7:4]}    : s2;
    end
  end
endmodule

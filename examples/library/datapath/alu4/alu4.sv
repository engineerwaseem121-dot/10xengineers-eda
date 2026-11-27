// alu4: 4-bit ALU with 8 operations and a zero flag
module alu4 (
  input  logic [3:0] a,
  input  logic [3:0] b,
  input  logic [2:0] op,
  output logic [3:0] result,
  output logic       zero
);
  localparam logic [2:0] OP_ADD = 3'd0;
  localparam logic [2:0] OP_SUB = 3'd1;
  localparam logic [2:0] OP_AND = 3'd2;
  localparam logic [2:0] OP_OR  = 3'd3;
  localparam logic [2:0] OP_XOR = 3'd4;
  localparam logic [2:0] OP_NOT = 3'd5;
  localparam logic [2:0] OP_SHL = 3'd6;
  localparam logic [2:0] OP_SHR = 3'd7;

  always_comb begin
    case (op)
      OP_ADD:  result = a + b;
      OP_SUB:  result = a - b;
      OP_AND:  result = a & b;
      OP_OR:   result = a | b;
      OP_XOR:  result = a ^ b;
      OP_NOT:  result = ~a;
      OP_SHL:  result = {a[2:0], 1'b0};
      default: result = {1'b0, a[3:1]};  // OP_SHR
    endcase
    zero = (result == 4'd0);
  end
endmodule

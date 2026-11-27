// alu8_flags: 8-bit ALU, 16 operations, zero/carry/negative/overflow flags
module alu8_flags (
  input  logic [7:0] a,
  input  logic [7:0] b,
  input  logic [3:0] op,
  output logic [7:0] result,
  output logic       zero,
  output logic       carry,
  output logic       negative,
  output logic       overflow
);
  localparam logic [3:0] OP_ADD  = 4'd0;
  localparam logic [3:0] OP_SUB  = 4'd1;
  localparam logic [3:0] OP_AND  = 4'd2;
  localparam logic [3:0] OP_OR   = 4'd3;
  localparam logic [3:0] OP_XOR  = 4'd4;
  localparam logic [3:0] OP_NOR  = 4'd5;
  localparam logic [3:0] OP_NOT  = 4'd6;
  localparam logic [3:0] OP_SHL  = 4'd7;
  localparam logic [3:0] OP_SHR  = 4'd8;
  localparam logic [3:0] OP_SAR  = 4'd9;
  localparam logic [3:0] OP_SLT  = 4'd10;
  localparam logic [3:0] OP_SLTU = 4'd11;
  localparam logic [3:0] OP_PASA = 4'd12;
  localparam logic [3:0] OP_PASB = 4'd13;
  localparam logic [3:0] OP_INC  = 4'd14;
  localparam logic [3:0] OP_DEC  = 4'd15;

  logic [8:0] sum9;   // a + b with carry out
  logic [8:0] diff9;  // a - b, bit 8 = borrow
  logic       lt_s;   // signed a < b

  always_comb begin
    sum9  = {1'b0, a} + {1'b0, b};
    diff9 = {1'b0, a} - {1'b0, b};
    lt_s  = $signed(a) < $signed(b);

    result   = 8'h00;
    carry    = 1'b0;
    overflow = 1'b0;

    case (op)
      OP_ADD: begin
        result   = sum9[7:0];
        carry    = sum9[8];
        overflow = (a[7] == b[7]) && (sum9[7] != a[7]);
      end
      OP_SUB: begin
        result   = diff9[7:0];
        carry    = diff9[8];                       // borrow: a < b unsigned
        overflow = (a[7] != b[7]) && (diff9[7] != a[7]);
      end
      OP_AND:  result = a & b;
      OP_OR:   result = a | b;
      OP_XOR:  result = a ^ b;
      OP_NOR:  result = ~(a | b);
      OP_NOT:  result = ~a;
      OP_SHL: begin
        result = {a[6:0], 1'b0};
        carry  = a[7];
      end
      OP_SHR: begin
        result = {1'b0, a[7:1]};
        carry  = a[0];
      end
      OP_SAR: begin
        result = {a[7], a[7:1]};
        carry  = a[0];
      end
      OP_SLT:  result = {7'b0, lt_s};
      OP_SLTU: result = {7'b0, diff9[8]};
      OP_PASA: result = a;
      OP_PASB: result = b;
      OP_INC: begin
        result   = a + 8'd1;
        carry    = (a == 8'hFF);
        overflow = (a == 8'h7F);
      end
      default: begin // OP_DEC
        result   = a - 8'd1;
        carry    = (a == 8'h00);                   // borrow
        overflow = (a == 8'h80);
      end
    endcase

    zero     = (result == 8'h00);
    negative = result[7];
  end
endmodule

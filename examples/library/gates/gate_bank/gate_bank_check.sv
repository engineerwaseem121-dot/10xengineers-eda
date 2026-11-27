module gate_bank_check;
  localparam int WIDTH = 8;
  logic [WIDTH-1:0] a, b;
  logic [WIDTH-1:0] and_o, or_o, xor_o, nand_o, nor_o, xnor_o;
  logic [WIDTH-1:0] e_and, e_or, e_xor, e_nand, e_nor, e_xnor;
  int errors = 0;
  gate_bank #(.WIDTH(WIDTH)) dut (.a(a), .b(b), .and_o(and_o), .or_o(or_o), .xor_o(xor_o),
                                  .nand_o(nand_o), .nor_o(nor_o), .xnor_o(xnor_o));
  initial begin
    for (int i = 0; i < (1 << (2*WIDTH)); i++) begin
      {a, b} = i[2*WIDTH-1:0];
      #1;
      // per-bit truth table model
      for (int k = 0; k < WIDTH; k++) begin
        case ({a[k], b[k]})
          2'b00: {e_and[k], e_or[k], e_xor[k]} = 3'b000;
          2'b01: {e_and[k], e_or[k], e_xor[k]} = 3'b011;
          2'b10: {e_and[k], e_or[k], e_xor[k]} = 3'b011;
          default: {e_and[k], e_or[k], e_xor[k]} = 3'b110;
        endcase
        e_nand[k] = !e_and[k];
        e_nor[k]  = !e_or[k];
        e_xnor[k] = !e_xor[k];
      end
      if (and_o !== e_and || or_o !== e_or || xor_o !== e_xor ||
          nand_o !== e_nand || nor_o !== e_nor || xnor_o !== e_xnor) begin
        errors++;
        if (errors < 10)
          $display("CHECK FAIL a=%h b=%h got and=%h or=%h xor=%h nand=%h nor=%h xnor=%h exp %h %h %h %h %h %h",
                   a, b, and_o, or_o, xor_o, nand_o, nor_o, xnor_o, e_and, e_or, e_xor, e_nand, e_nor, e_xnor);
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

module seven_seg_decoder_check;
  logic [3:0] digit;
  logic [6:0] seg, exp;
  int errors = 0;
  seven_seg_decoder dut (.digit(digit), .seg(seg));

  // digits for which each segment (0=a .. 6=g) is lit, taken from SPEC.md
  function automatic string lit_list(input int s);
    case (s)
      0: return "02356789ACEF";
      1: return "01234789Ad";
      2: return "013456789Abd";
      3: return "0235689bCdE";
      4: return "0268AbCdEF";
      5: return "045689AbCEF";
      default: return "2345689AbdEF";
    endcase
  endfunction

  function automatic int hexval(input byte c);
    if (c >= "0" && c <= "9") return c - "0";
    if (c >= "A" && c <= "F") return c - "A" + 10;
    if (c >= "a" && c <= "f") return c - "a" + 10;
    return -1;
  endfunction

  initial begin
    for (int v = 0; v < 16; v++) begin
      digit = v[3:0];
      for (int s = 0; s < 7; s++) begin
        string l;
        l = lit_list(s);
        exp[s] = 1'b0;
        for (int k = 0; k < l.len(); k++) if (hexval(l[k]) == v) exp[s] = 1'b1;
      end
      #1;
      if (seg !== exp) begin
        $display("mismatch digit=%h seg=%b exp=%b", digit, seg, exp);
        errors++;
      end
    end
    if (errors == 0) $display("CHECK PASS");
    else $display("CHECK FAIL %0d mismatches", errors);
    $finish;
  end
endmodule

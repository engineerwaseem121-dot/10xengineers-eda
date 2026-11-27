# Write the expected behaviour

For a design without a built-in template, the testbench needs to know what each output *should* be.

1. Run **DV: Write Expected Behaviour**. It lists the inputs and their widths, with one field per output.
2. Write each output as an expression of the inputs, **from the specification**:
   - `op == 0 ? a + b : op == 1 ? a - b : a & b`
   - `{a[3:0], b[7:4]}`
   - `$signed(a) < $signed(b)`
3. Each field is checked as you type: syntax, names (*did you mean*), widths, and an example value.
4. **Save & generate**. The same expressions drive the SystemVerilog, UVM and cocotb testbenches.

> **Optional AI draft:** paste the relevant part of the spec and press *AI draft*. Turn it on with `tenxDebug.dv.ai.enable`. Nothing is sent without your confirmation, and every field is shown for review.

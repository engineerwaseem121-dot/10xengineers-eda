# Select the design under test

1. Open your RTL file, for example `adder.sv`.
2. Run **DV: Select DUT**:
   - **Top module:** the module you want to verify.
   - **Template:** the first entry is what the extension identified, with the reason. For example *"priority encoder: one-hot input with an index output and a valid flag"*, or *"AMBA APB slave: verify with bus transactions"*.
3. When the RTL sits loose in the project folder, **Move RTL to design/** puts it in the standard layout.

The result is `dvflow.json`: ports, clock and reset, and the expected behaviour.

> **Templates that check a design automatically:** gate, adder, subtractor, adder-subtractor, multiplier, comparator, mux, demux, encoder, priority encoder, decoder, Gray converter, parity, flip-flop, latch, shift register, counter, up/down counter, pipeline, FIFO and memory. For anything else, choose **custom** and use the next step.

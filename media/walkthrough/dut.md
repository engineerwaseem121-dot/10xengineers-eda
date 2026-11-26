# Select the design under test

1. Open your RTL file, for example `adder.sv`.
2. Run **DV: Select DUT** and answer the prompts:
   - **Top module:** the module you want to verify.
   - **Dependencies:** only *other* files the DUT needs. Press **Cancel** if the file is self-contained.
   - **Template:** the first entry, marked *suggested from the RTL*, describes what the design does (adder, counter, register, pipeline…). The template supplies the reference model, the expected results the tests compare against.

The result is `dvflow.json`: ports, clock and reset, and the behaviour spec. Review it before generating.

> Choose **custom** only if you'll write the expected-results model yourself. Until you do, runs stop with a message instead of failing every check.

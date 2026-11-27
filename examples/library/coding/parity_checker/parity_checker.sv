// parity_checker: flags an error when data + parity_in has an odd number of ones
module parity_checker (
  input  logic [7:0] data,
  input  logic       parity_in,
  output logic       error
);
  assign error = (^data) ^ parity_in;
endmodule

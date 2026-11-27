// valid_ready_pipeline: two-stage valid/ready pipeline, data passes unchanged
module valid_ready_pipeline #(
  parameter int DATA_W = 8
) (
  input  logic              clk,
  input  logic              rst_n,
  input  logic              in_valid,
  output logic              in_ready,
  input  logic [DATA_W-1:0] in_data,
  output logic              out_valid,
  input  logic              out_ready,
  output logic [DATA_W-1:0] out_data
);
  logic              v1, v2;
  logic [DATA_W-1:0] d1, d2;
  logic              rdy1, rdy2;

  // a stage can load when it is empty or its content leaves this cycle
  assign rdy2     = !v2 || out_ready;
  assign rdy1     = !v1 || rdy2;
  assign in_ready = rdy1;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      v1 <= 1'b0;
      v2 <= 1'b0;
      d1 <= '0;
      d2 <= '0;
    end else begin
      if (rdy1) begin
        v1 <= in_valid;
        if (in_valid) d1 <= in_data;
      end
      if (rdy2) begin
        v2 <= v1;
        if (v1) d2 <= d1;
      end
    end
  end

  assign out_valid = v2;
  assign out_data  = d2;
endmodule

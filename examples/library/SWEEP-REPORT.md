# Library sweep (2026-11-27, icarus)
- Designs: **106**
- Identified as expected: **106/106** (100%)
- Protocol recognised: **13/13**
- Regression with the identified template: **62/62 pass** (44 have no automatic template yet: custom / FSM / protocol, written via behavior.checks)
| Design | Category | Expected | Identified | Conf. | Protocol | Regression | Detail |
|---|---|---|---|---|---|---|---|
| abs8 | arithmetic | custom | custom | low |  | PASS 8/8 |  |
| add_sub8 | arithmetic | add_sub | add_sub | medium |  | PASS 6/6 |  |
| cla_adder4 | arithmetic | adder | adder | medium |  | PASS 8/8 |  |
| comparator4 | arithmetic | comparator | comparator | medium |  | PASS 8/8 |  |
| comparator_signed8 | arithmetic | comparator | comparator | medium |  | PASS 6/6 |  |
| full_adder | arithmetic | adder | adder | medium |  | PASS 8/8 |  |
| full_subtractor | arithmetic | subtractor | subtractor | medium |  | PASS 8/8 |  |
| half_adder | arithmetic | adder | adder | medium |  | PASS 8/8 |  |
| half_subtractor | arithmetic | subtractor | subtractor | medium |  | PASS 8/8 |  |
| incrementer8 | arithmetic | adder | adder | medium |  | PASS 8/8 |  |
| multiplier4 | arithmetic | multiplier | multiplier | medium |  | PASS 8/8 |  |
| multiplier8_signed | arithmetic | multiplier | multiplier | medium |  | PASS 6/6 |  |
| ripple_adder8 | arithmetic | adder | adder | medium |  | PASS 8/8 |  |
| subtractor8 | arithmetic | subtractor | subtractor | medium |  | PASS 6/6 |  |
| bin2bcd8 | coding | code_converter | code_converter | medium |  | PASS 8/8 |  |
| bin2gray | coding | code_converter | code_converter | medium |  | PASS 8/8 |  |
| crc16_ccitt_serial | coding | crc | crc | high |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| crc8_comb | coding | crc | crc | high |  | needs behaviour | expected behaviour not written yet |
| even_parity_gen | coding | parity | parity | high |  | PASS 8/8 |  |
| gray2bin | coding | code_converter | code_converter | high |  | PASS 8/8 |  |
| hamming74_dec | coding | hamming | hamming | high |  | needs behaviour | expected behaviour not written yet |
| hamming74_enc | coding | hamming | hamming | medium |  | needs behaviour | expected behaviour not written yet |
| parity_checker | coding | parity | parity | high |  | PASS 8/8 |  |
| gray_counter | counters | custom | custom | low |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| johnson_counter4 | counters | custom | custom | low |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| lfsr8 | counters | lfsr | lfsr | high |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| mod10_counter | counters | counter | counter | medium |  | PASS 8/8 |  |
| program_counter | counters | pc | pc | medium |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| ring_counter4 | counters | custom | custom | low |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| updown_counter8 | counters | updown_counter | updown_counter | high |  | PASS 8/8 |  |
| up_counter4 | counters | counter | counter | medium |  | PASS 8/8 |  |
| alu4 | datapath | alu | alu | medium |  | PASS 8/8 |  |
| alu8_flags | datapath | alu | alu | medium |  | needs behaviour | expected behaviour not written yet |
| barrel_shifter8 | datapath | custom | custom | low |  | PASS 8/8 |  |
| leading_zero_count | datapath | custom | custom | low |  | PASS 6/6 |  |
| mac_unit | datapath | custom | custom | low |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| popcount8 | datapath | custom | custom | low |  | PASS 8/8 |  |
| saturating_adder | datapath | custom | custom | low |  | PASS 6/6 |  |
| decoder2to4 | encode_decode | decoder | decoder | high |  | PASS 8/8 |  |
| decoder3to8_en | encode_decode | decoder | decoder | high |  | PASS 8/8 |  |
| encoder4to2 | encode_decode | encoder | encoder | high |  | PASS 6/6 |  |
| encoder8to3 | encode_decode | encoder | encoder | high |  | PASS 6/6 |  |
| onehot_to_bin | encode_decode | encoder | encoder | high |  | PASS 6/6 |  |
| priority_encoder4 | encode_decode | priority_encoder | priority_encoder | high |  | PASS 8/8 |  |
| priority_encoder8 | encode_decode | priority_encoder | priority_encoder | high |  | PASS 8/8 |  |
| seven_seg_decoder | encode_decode | decoder | decoder | high |  | PASS 8/8 |  |
| fifo_almost | fifo | fifo | fifo | high |  | PASS 8/8 |  |
| fifo_fwft | fifo | fifo | fifo | high |  | PASS 8/8 |  |
| fifo_sync | fifo | fifo | fifo | high |  | PASS 8/8 |  |
| elevator_2floor | fsm | fsm | fsm | medium |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| handshake_ctrl | fsm | fsm | fsm | medium |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| round_robin_arbiter4 | fsm | fsm | fsm | medium |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| seq_detector_1011_mealy | fsm | fsm | fsm | medium |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| seq_detector_1011_moore | fsm | fsm | fsm | medium |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| traffic_light_ctrl | fsm | fsm | fsm | medium |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| vending_machine | fsm | fsm | fsm | medium |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| and2 | gates | gate | gate | medium |  | PASS 8/8 |  |
| and_n | gates | gate | gate | medium |  | PASS 8/8 |  |
| buf1 | gates | gate | gate | medium |  | PASS 8/8 |  |
| gate_bank | gates | gate | gate | medium |  | PASS 6/6 |  |
| nand2 | gates | gate | gate | medium |  | PASS 8/8 |  |
| nor2 | gates | gate | gate | medium |  | PASS 8/8 |  |
| not1 | gates | gate | gate | medium |  | PASS 8/8 |  |
| or2 | gates | gate | gate | medium |  | PASS 8/8 |  |
| or_vec | gates | gate | gate | medium |  | PASS 6/6 |  |
| xnor2 | gates | gate | gate | medium |  | PASS 8/8 |  |
| xor2 | gates | gate | gate | medium |  | PASS 8/8 |  |
| ram_dp | memory | custom | custom | low |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| ram_sp | memory | memory | memory | high |  | PASS 8/8 |  |
| register_file_2r1w | memory | register_file | register_file | high |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| rom16x8 | memory | memory | memory | high |  | needs behaviour | template "memory" does not fit rom16x8 (Could not map all DUT ports for template 'memory'. Set "ports" in dvflow.json (detected: {"addr":"addr","rdata":"dout"}).); started as "custom": write its expec |
| demux1to4 | mux_demux | demux | demux | high |  | PASS 8/8 |  |
| demux1to8 | mux_demux | demux | demux | high |  | PASS 8/8 |  |
| mux2 | mux_demux | mux | mux | high |  | PASS 6/6 |  |
| mux4 | mux_demux | mux | mux | high |  | PASS 6/6 |  |
| mux8 | mux_demux | mux | mux | high |  | PASS 6/6 |  |
| mux_param | mux_demux | mux | mux | high |  | PASS 6/6 |  |
| ahb_lite_sram_slave | protocols | custom | custom | low | ahb | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| apb_master_simple | protocols | custom | custom | low | apb | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| apb_slave_regs | protocols | custom | custom | low | apb | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| axi4lite_slave_regs | protocols | custom | custom | low | axi4lite | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| axis_fifo | protocols | fifo | fifo | high | axis | needs behaviour | template "fifo" does not fit axis_fifo (Could not map all DUT ports for template 'fifo'. Set "ports" in dvflow.json (detected: {"wr_data":"s_axis_tdata","rd_data":"m_axis_tdata"}).); started as "custo |
| axis_skid_buffer | protocols | pipeline | pipeline | high | axis | needs behaviour | template "pipeline" does not fit axis_skid_buffer (the pipeline template does not drive 'm_axis_tready' (valid/ready backpressure is not modelled yet)); started as "custom": write its expected behavio |
| i2c_master_write | protocols | custom | custom | low | i2c | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| pwm_gen | protocols | custom | custom | low |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| spi_master | protocols | custom | custom | low | spi | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| spi_slave | protocols | custom | custom | low | spi | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| timer_apb | protocols | custom | custom | low | apb | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| uart_rx | protocols | custom | custom | low | uart | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| uart_tx | protocols | custom | custom | low | uart | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| valid_ready_pipeline | protocols | pipeline | pipeline | medium |  | needs behaviour | template "pipeline" does not fit valid_ready_pipeline (the pipeline template does not drive 'out_ready' (valid/ready backpressure is not modelled yet)); started as "custom": write its expected behavio |
| wishbone_slave_regs | protocols | custom | custom | low | wishbone | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| clock_divider | sequential | custom | custom | low |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| debouncer | sequential | custom | custom | low |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| dff_async | sequential | dff | dff | medium |  | PASS 6/6 |  |
| dff_en | sequential | dff | dff | medium |  | PASS 8/8 |  |
| dff_sync_reset | sequential | dff | dff | medium |  | PASS 6/6 |  |
| d_latch | sequential | latch | latch | high |  | PASS 4/4 |  |
| edge_detector | sequential | custom | custom | low |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| jk_ff | sequential | custom | custom | low |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| piso_shift | sequential | shift_register | shift_register | medium |  | needs behaviour | template "shift_register" does not fit piso_shift (Could not map all DUT ports for template 'shift_register'. Set "ports" in dvflow.json (detected: {"load":"load","sout":"sout"}).); started as "custom |
| register8_load | sequential | dff | dff | medium |  | PASS 8/8 |  |
| sipo_shift | sequential | shift_register | shift_register | medium |  | PASS 6/6 |  |
| siso_shift | sequential | shift_register | shift_register | medium |  | needs behaviour | template "shift_register" does not fit siso_shift (Could not map all DUT ports for template 'shift_register'. Set "ports" in dvflow.json (detected: {"sin":"sin","sout":"sout"}).); started as "custom": |
| t_ff | sequential | custom | custom | low |  | needs behaviour | clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/ |
| universal_shift4 | sequential | shift_register | shift_register | medium |  | needs behaviour | template "shift_register" does not fit universal_shift4 (Could not map all DUT ports for template 'shift_register'. Set "ports" in dvflow.json (detected: {"q":"q"}).); started as "custom": write its e |

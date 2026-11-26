/* 10xEngineers EDA — waveform analysis library (UMD: browser global WaveTools, or require()).
 * Signals are change lists {t:[times], v:[binary strings]} as produced by the VCD parser.
 * Protocol decoders (UART, SPI, SPI-Flash, I²C, APB, AHB-Lite, AXI4-Lite, AXI-Stream, Wishbone, RISC-V trace, valid/ready)
 * + transaction tables, multi-signal pattern search, switching activity, X-trace, colour contrast. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WaveTools = factory(); })(this, function () {
  'use strict';

  function idxAt(d, t) {
    const a = d.t;
    if (!a.length || a[0] > t) return -1;
    let lo = 0, hi = a.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= t) lo = m; else hi = m - 1; }
    return lo;
  }
  const valAt = (d, t) => { const k = idxAt(d, t); return k < 0 ? null : d.v[k]; };
  const isKnown = v => v != null && !/[^01]/.test(v);
  const num = v => (isKnown(v) ? (v.length <= 52 ? parseInt(v, 2) : Number(BigInt('0b' + v))) : null);
  const bit = (d, t) => { const v = valAt(d, t); return v == null ? null : v[v.length - 1]; };
  const hex = (n, w) => (n == null ? 'x' : '0x' + n.toString(16).padStart(Math.max(1, Math.ceil((w || 8) / 4)), '0'));
  /** times of rising (or falling) edges of a 1-bit signal */
  function edges(d, rising) {
    const out = [];
    for (let k = 1; k < d.t.length; k++) { const a = d.v[k - 1], b = d.v[k]; if (rising ? (a === '0' && b === '1') : (a === '1' && b === '0')) out.push(d.t[k]); }
    if (d.v.length && d.t.length && rising === null) return d.t.slice();
    return out;
  }
  const S = (sig, t) => num(valAt(sig, t));         // sample (value just before / at t)
  const W = s => (s && s.v && s.v.length ? s.v[0].length : 32);                  // bit width of a bus
  const hx = (s, t) => (s ? hex(num(valAt(s, t - 1e-9)), W(s)) : '');            // value before t, at its own width
  const before = (sig, t) => S(sig, t - 1e-9);       // value immediately before an edge

  /* --------------------------------------------------------------- SPI frames (shared by SPI-Flash) */
  /** bytes per chip-select frame: [{t0, t1, mo:[bytes], mi:[bytes]}] */
  function spiFrames(sig, p) {
    const cpol = Number(p.cpol) || 0, cpha = Number(p.cpha) || 0;
    const clk = edges(sig.sclk, (cpol === 0) !== (cpha === 1));
    const frames = [];
    let cur = null, bits = 0, mo = 0, mi = 0;
    const csRise = sig.cs_n ? edges(sig.cs_n, true) : [];
    let ci = 0;
    for (const t of clk) {
      if (sig.cs_n && before(sig.cs_n, t) !== 0) continue;
      let closed = false;
      while (ci < csRise.length && csRise[ci] < t) { ci++; closed = true; }
      if (!cur || closed) { if (cur) frames.push(cur); cur = { t0: t, t1: t, mo: [], mi: [] }; bits = 0; mo = 0; mi = 0; }
      mo = (mo << 1) | (sig.mosi ? before(sig.mosi, t) || 0 : 0);
      mi = (mi << 1) | (sig.miso ? before(sig.miso, t) || 0 : 0);
      cur.t1 = t;
      if (++bits === 8) { cur.mo.push(mo & 255); cur.mi.push(mi & 255); bits = 0; mo = 0; mi = 0; }
    }
    if (cur) frames.push(cur);
    // close times: the CS rise that ends each frame
    frames.forEach(f => { const r = csRise.find(x => x >= f.t1); if (r != null) f.t1 = r; });
    return frames;
  }
  // a: address bytes ('A' = addrBytes parameter), d: dummy bytes, dir: r = data on MISO, w = data on MOSI
  const FLASH_OPS = {
    0x03: { n: 'READ', a: 'A', dir: 'r' }, 0x0b: { n: 'FAST_READ', a: 'A', d: 1, dir: 'r' }, 0x3b: { n: 'DUAL_OUT_READ', a: 'A', d: 1, dir: 'r' }, 0x6b: { n: 'QUAD_OUT_READ', a: 'A', d: 1, dir: 'r' },
    0x13: { n: 'READ4B', a: 4, dir: 'r' }, 0x0c: { n: 'FAST_READ4B', a: 4, d: 1, dir: 'r' },
    0x02: { n: 'PAGE_PROGRAM', a: 'A', dir: 'w', needsWel: true }, 0x12: { n: 'PAGE_PROGRAM4B', a: 4, dir: 'w', needsWel: true },
    0x06: { n: 'WREN', a: 0 }, 0x04: { n: 'WRDI', a: 0 }, 0x05: { n: 'RDSR', a: 0, dir: 'r' }, 0x35: { n: 'RDSR2', a: 0, dir: 'r' }, 0x15: { n: 'RDSR3', a: 0, dir: 'r' },
    0x01: { n: 'WRSR', a: 0, dir: 'w', needsWel: true }, 0x9f: { n: 'RDID', a: 0, dir: 'r' }, 0x90: { n: 'REMS', a: 3, dir: 'r' }, 0xab: { n: 'RES', a: 0, d: 3, dir: 'r' },
    0x5a: { n: 'RDSFDP', a: 3, d: 1, dir: 'r' }, 0x4b: { n: 'RDUID', a: 0, d: 4, dir: 'r' },
    0x20: { n: 'SECTOR_ERASE_4K', a: 'A', needsWel: true }, 0x52: { n: 'BLOCK_ERASE_32K', a: 'A', needsWel: true }, 0xd8: { n: 'BLOCK_ERASE_64K', a: 'A', needsWel: true },
    0xc7: { n: 'CHIP_ERASE', a: 0, needsWel: true }, 0x60: { n: 'CHIP_ERASE', a: 0, needsWel: true },
    0xb9: { n: 'DEEP_POWER_DOWN', a: 0 }, 0x66: { n: 'RESET_ENABLE', a: 0 }, 0x99: { n: 'RESET', a: 0 }, 0xb7: { n: 'ENTER_4B', a: 0 }, 0xe9: { n: 'EXIT_4B', a: 0 }
  };

  /* --------------------------------------------------------------- RISC-V disassembler (RV32I + M + Zicsr + common C) */
  const XR = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];
  const CSRN = { 0x300: 'mstatus', 0x301: 'misa', 0x304: 'mie', 0x305: 'mtvec', 0x340: 'mscratch', 0x341: 'mepc', 0x342: 'mcause', 0x343: 'mtval', 0x344: 'mip', 0xb00: 'mcycle', 0xb02: 'minstret', 0xc00: 'cycle', 0xc01: 'time', 0xc02: 'instret', 0xf14: 'mhartid' };
  const sx = (v, b) => (v << (32 - b)) >> (32 - b);
  const tgt = (pc, off) => (pc == null ? (off >= 0 ? '+' : '') + off : '0x' + ((pc + off) >>> 0).toString(16));
  function rvDisasm(w, pc) {
    if ((w & 3) !== 3) return rvc(w & 0xffff, pc);
    const op = w & 0x7f, rd = (w >> 7) & 31, f3 = (w >> 12) & 7, rs1 = (w >> 15) & 31, rs2 = (w >> 20) & 31, f7 = w >>> 25;
    const R = XR, iimm = w >> 20, simm = ((w >> 25) << 5) | ((w >> 7) & 31);
    const bimm = sx((((w >>> 31) & 1) << 12) | (((w >> 7) & 1) << 11) | (((w >> 25) & 63) << 5) | (((w >> 8) & 15) << 1), 13);
    const jimm = sx((((w >>> 31) & 1) << 20) | (((w >> 12) & 255) << 12) | (((w >> 20) & 1) << 11) | (((w >> 21) & 1023) << 1), 21);
    const r = (cls, text, flow) => ({ cls, text, len: 4, flow: !!flow });
    switch (op) {
      case 0x37: return r('ALU', `lui ${R[rd]}, 0x${(w >>> 12).toString(16)}`);
      case 0x17: return r('ALU', `auipc ${R[rd]}, 0x${(w >>> 12).toString(16)}`);
      case 0x6f: return r('JUMP', rd ? `jal ${R[rd]}, ${tgt(pc, jimm)}` : `j ${tgt(pc, jimm)}`);
      case 0x67: return r('JUMP', rd === 0 && rs1 === 1 && !iimm ? 'ret' : `jalr ${R[rd]}, ${iimm}(${R[rs1]})`);
      case 0x63: { const n = ['beq', 'bne', '?', '?', 'blt', 'bge', 'bltu', 'bgeu'][f3]; return n === '?' ? ill(4) : r('BRANCH', `${n} ${R[rs1]}, ${R[rs2]}, ${tgt(pc, bimm)}`, true); }
      case 0x03: { const n = ['lb', 'lh', 'lw', '?', 'lbu', 'lhu', '?', '?'][f3]; return n === '?' ? ill(4) : r('LOAD', `${n} ${R[rd]}, ${iimm}(${R[rs1]})`); }
      case 0x23: { const n = ['sb', 'sh', 'sw'][f3]; return !n ? ill(4) : r('STORE', `${n} ${R[rs2]}, ${simm}(${R[rs1]})`); }
      case 0x13: {
        if (w === 0x13) return r('ALU', 'nop');
        const sh = rs2;
        const n = ['addi', 'slli', 'slti', 'sltiu', 'xori', f7 === 0x20 ? 'srai' : 'srli', 'ori', 'andi'][f3];
        if (f3 === 0 && rs1 === 0) return r('ALU', `li ${R[rd]}, ${iimm}`);
        if (f3 === 0 && iimm === 0) return r('ALU', `mv ${R[rd]}, ${R[rs1]}`);
        return r('ALU', `${n} ${R[rd]}, ${R[rs1]}, ${f3 === 1 || f3 === 5 ? sh : iimm}`);
      }
      case 0x33: {
        if (f7 === 1) return r('MUL', `${['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'][f3]} ${R[rd]}, ${R[rs1]}, ${R[rs2]}`);
        const n = f7 === 0x20 ? { 0: 'sub', 5: 'sra' }[f3] : f7 === 0 ? ['add', 'sll', 'slt', 'sltu', 'xor', 'srl', 'or', 'and'][f3] : null;
        return n ? r('ALU', `${n} ${R[rd]}, ${R[rs1]}, ${R[rs2]}`) : ill(4);
      }
      case 0x0f: return r('SYSTEM', f3 === 1 ? 'fence.i' : 'fence');
      case 0x73: {
        if (f3 === 0) return r('SYSTEM', { 0: 'ecall', 1: 'ebreak', 0x302: 'mret', 0x105: 'wfi' }[(w >>> 20)] || 'system?');
        const csr = w >>> 20, cn = CSRN[csr] || '0x' + csr.toString(16);
        const n = ['', 'csrrw', 'csrrs', 'csrrc', '', 'csrrwi', 'csrrsi', 'csrrci'][f3];
        return n ? r('CSR', `${n} ${R[rd]}, ${cn}, ${f3 >= 5 ? rs1 : R[rs1]}`) : ill(4);
      }
    }
    return ill(4);
  }
  function ill(len) { return { cls: 'ILLEGAL', text: 'illegal', len, illegal: true }; }
  function rvc(h, pc) {
    const q = h & 3, f3 = h >> 13, r = (cls, text, flow) => ({ cls, text, len: 2, flow: !!flow });
    const rp = n => XR[8 + (n & 7)], rd = (h >> 7) & 31, rs2 = (h >> 2) & 31;
    const ci = sx((((h >> 12) & 1) << 5) | ((h >> 2) & 31), 6);
    const cj = sx((((h >> 12) & 1) << 11) | (((h >> 8) & 1) << 10) | (((h >> 9) & 3) << 8) | (((h >> 6) & 1) << 7) | (((h >> 7) & 1) << 6) | (((h >> 2) & 1) << 5) | (((h >> 11) & 1) << 4) | (((h >> 3) & 7) << 1), 12);
    const cb = sx((((h >> 12) & 1) << 8) | (((h >> 5) & 3) << 6) | (((h >> 2) & 1) << 5) | (((h >> 10) & 3) << 3) | (((h >> 3) & 3) << 1), 9);
    if (h === 0) return ill(2);
    if (q === 0) {
      if (f3 === 0) return r('ALU', `c.addi4spn ${rp(h >> 2)}, sp, ${(((h >> 7) & 15) << 6) | (((h >> 11) & 3) << 4) | (((h >> 5) & 1) << 3) | (((h >> 6) & 1) << 2)}`);
      const off = (((h >> 10) & 7) << 3) | (((h >> 6) & 1) << 2) | (((h >> 5) & 1) << 6);
      if (f3 === 2) return r('LOAD', `c.lw ${rp(h >> 2)}, ${off}(${rp(h >> 7)})`);
      if (f3 === 6) return r('STORE', `c.sw ${rp(h >> 2)}, ${off}(${rp(h >> 7)})`);
      return ill(2);
    }
    if (q === 1) {
      switch (f3) {
        case 0: return r('ALU', rd ? `c.addi ${XR[rd]}, ${ci}` : 'c.nop');
        case 1: return r('JUMP', `c.jal ${tgt(pc, cj)}`);
        case 2: return r('ALU', `c.li ${XR[rd]}, ${ci}`);
        case 3: return rd === 2 ? r('ALU', `c.addi16sp sp, ${sx((((h >> 12) & 1) << 9) | (((h >> 3) & 3) << 7) | (((h >> 5) & 1) << 6) | (((h >> 2) & 1) << 5) | (((h >> 6) & 1) << 4), 10)}`) : r('ALU', `c.lui ${XR[rd]}, 0x${(ci & 0xfffff).toString(16)}`);
        case 4: {
          const f2 = (h >> 10) & 3, d = rp(h >> 7);
          if (f2 === 0) return r('ALU', `c.srli ${d}, ${ci & 63}`);
          if (f2 === 1) return r('ALU', `c.srai ${d}, ${ci & 63}`);
          if (f2 === 2) return r('ALU', `c.andi ${d}, ${ci}`);
          return r('ALU', `c.${['sub', 'xor', 'or', 'and'][(h >> 5) & 3]} ${d}, ${rp(h >> 2)}`);
        }
        case 5: return r('JUMP', `c.j ${tgt(pc, cj)}`);
        case 6: return r('BRANCH', `c.beqz ${rp(h >> 7)}, ${tgt(pc, cb)}`, true);
        case 7: return r('BRANCH', `c.bnez ${rp(h >> 7)}, ${tgt(pc, cb)}`, true);
      }
    }
    if (q === 2) {
      const b12 = (h >> 12) & 1;
      if (f3 === 0) return r('ALU', `c.slli ${XR[rd]}, ${ci & 63}`);
      if (f3 === 2) return r('LOAD', `c.lwsp ${XR[rd]}, ${(((h >> 4) & 7) << 2) | (b12 << 5) | (((h >> 2) & 3) << 6)}(sp)`);
      if (f3 === 6) return r('STORE', `c.swsp ${XR[rs2]}, ${(((h >> 9) & 15) << 2) | (((h >> 7) & 3) << 6)}(sp)`);
      if (f3 === 4) {
        if (!b12) return rs2 ? r('ALU', `c.mv ${XR[rd]}, ${XR[rs2]}`) : r('JUMP', rd === 1 ? 'c.jr ra (ret)' : `c.jr ${XR[rd]}`);
        if (!rd && !rs2) return r('SYSTEM', 'c.ebreak');
        return rs2 ? r('ALU', `c.add ${XR[rd]}, ${XR[rs2]}`) : r('JUMP', `c.jalr ${XR[rd]}`);
      }
    }
    return ill(2);
  }

  /* --------------------------------------------------------------- decoders: each returns [{t, t1, kind, addr, data, info, error}] */
  const DECODERS = {
    uart: {
      label: 'UART (8N1)', roles: ['rx'], params: { bitTime: 'auto', dataBits: 8, parity: 'none', idle: 1 },
      decode(sig, p, meta) {
        const d = sig.rx; const out = [];
        let bt = Number(p.bitTime);
        if (!bt || isNaN(bt)) { let min = Infinity; for (let k = 1; k < d.t.length; k++) { const w = d.t[k] - d.t[k - 1]; if (w > 0 && w < min) min = w; } bt = isFinite(min) ? min : 1; }
        const n = Number(p.dataBits) || 8;
        let k = 0;
        while (k < d.t.length) {
          // start bit = falling edge from idle
          if (!(d.v[k] === '0' && (k === 0 || d.v[k - 1] === '1'))) { k++; continue; }
          const t0 = d.t[k];
          if (bit(d, t0 + bt / 2) !== '0') { k++; continue; }
          let val = 0, err = '';
          for (let b = 0; b < n; b++) { const s = bit(d, t0 + bt * (1.5 + b)); if (s === '1') val |= (1 << b); else if (s !== '0') err = 'X in data'; }
          const stopT = t0 + bt * (1.5 + n + (p.parity !== 'none' ? 1 : 0));
          if (bit(d, stopT) !== '1') err = err || 'framing error (stop bit low)';
          out.push({ t: t0, t1: stopT + bt / 2, kind: 'byte', data: hex(val, 8), info: (val >= 32 && val < 127 ? `'${String.fromCharCode(val)}'` : '') + (meta ? ` bit time ${bt}` : ''), error: err });
          k = idxAt(d, stopT) + 1;
        }
        return out;
      }
    },
    spi: {
      label: 'SPI', roles: ['sclk', 'mosi', 'miso', 'cs_n'], params: { cpol: 0, cpha: 0, bitsPerWord: 8, msbFirst: 1 },
      decode(sig, p) {
        const out = [];
        const cpol = Number(p.cpol), cpha = Number(p.cpha), n = Number(p.bitsPerWord) || 8;
        const sampleRising = (cpol === 0) !== (cpha === 1);
        const clkEdges = edges(sig.sclk, sampleRising);
        let mo = 0, mi = 0, cnt = 0, t0 = null;
        for (const t of clkEdges) {
          if (sig.cs_n && before(sig.cs_n, t) !== 0) { cnt = 0; mo = 0; mi = 0; continue; }
          if (cnt === 0) t0 = t;
          const a = sig.mosi ? before(sig.mosi, t) : 0, b = sig.miso ? before(sig.miso, t) : 0;
          if (Number(p.msbFirst)) { mo = (mo << 1) | (a || 0); mi = (mi << 1) | (b || 0); } else { mo |= (a || 0) << cnt; mi |= (b || 0) << cnt; }
          if (++cnt === n) { out.push({ t: t0, t1: t, kind: 'word', data: hex(mo >>> 0, n), info: 'MISO ' + hex(mi >>> 0, n) }); cnt = 0; mo = 0; mi = 0; }
        }
        return out;
      }
    },
    i2c: {
      label: 'I²C', roles: ['scl', 'sda'], params: {},
      decode(sig) {
        const out = [];
        const { scl, sda } = sig;
        // events: START (sda falls while scl high), STOP (sda rises while scl high), bit samples on scl rising
        const evs = [];
        for (let k = 1; k < sda.t.length; k++) { const t = sda.t[k]; if (before(scl, t) === 1) { if (sda.v[k - 1] === '1' && sda.v[k] === '0') evs.push({ t, e: 'S' }); else if (sda.v[k - 1] === '0' && sda.v[k] === '1') evs.push({ t, e: 'P' }); } }
        edges(scl, true).forEach(t => evs.push({ t, e: 'b', v: S(sda, t) }));
        evs.sort((a, b) => a.t - b.t);
        let bits = [], inFrame = false, first = true, rw = 0, t0 = 0, addr = null;
        for (const ev of evs) {
          if (ev.e === 'S') { inFrame = true; bits = []; first = true; t0 = ev.t; out.push({ t: ev.t, t1: ev.t, kind: 'START', data: '', info: '' }); continue; }
          if (ev.e === 'P') { inFrame = false; out.push({ t: ev.t, t1: ev.t, kind: 'STOP', data: '', info: '' }); continue; }
          if (!inFrame) continue;
          if (bits.length === 0) t0 = ev.t;
          bits.push(ev.v);
          if (bits.length === 9) {
            const byte = bits.slice(0, 8).reduce((a, b) => (a << 1) | (b || 0), 0);
            const ack = bits[8] === 0 ? 'ACK' : 'NACK';
            if (first) { addr = byte >> 1; rw = byte & 1; out.push({ t: t0, t1: ev.t, kind: rw ? 'ADDR R' : 'ADDR W', addr: hex(addr, 7), data: '', info: ack, error: ack === 'NACK' ? 'address not acknowledged' : '' }); first = false; }
            else out.push({ t: t0, t1: ev.t, kind: rw ? 'READ' : 'WRITE', addr: hex(addr, 7), data: hex(byte, 8), info: ack });
            bits = [];
          }
        }
        return out;
      }
    },
    apb: {
      label: 'APB', roles: ['pclk', 'psel', 'penable', 'pwrite', 'paddr', 'pwdata', 'prdata', 'pready', 'pslverr'], params: {},
      decode(sig) {
        const out = []; let setup = null;
        for (const t of edges(sig.pclk, true)) {
          const sel = before(sig.psel, t), en = before(sig.penable, t), rdy = sig.pready ? before(sig.pready, t) : 1;
          if (sel === 1 && en === 0) setup = t;
          if (sel === 1 && en === 1 && rdy === 1) {
            const w = before(sig.pwrite, t);
            out.push({ t: setup != null ? setup : t, t1: t, kind: w ? 'WRITE' : 'READ', addr: hx(sig.paddr, t), data: w ? hx(sig.pwdata, t) : hx(sig.prdata, t), info: sig.pslverr && before(sig.pslverr, t) === 1 ? 'SLVERR' : 'OKAY', error: sig.pslverr && before(sig.pslverr, t) === 1 ? 'PSLVERR' : '' });
            setup = null;
          }
        }
        return out;
      }
    },
    ahb: {
      label: 'AHB-Lite', roles: ['hclk', 'htrans', 'haddr', 'hwrite', 'hwdata', 'hrdata', 'hready', 'hresp'], params: {},
      decode(sig) {
        const out = []; let pend = null;
        for (const t of edges(sig.hclk, true)) {
          const rdy = sig.hready ? before(sig.hready, t) : 1;
          if (rdy !== 1) continue;
          if (pend) { // data phase completes on this edge
            out.push({ t: pend.t, t1: t, kind: pend.w ? 'WRITE' : 'READ', addr: hex(pend.a, W(sig.haddr)), data: pend.w ? hx(sig.hwdata, t) : hx(sig.hrdata, t), info: sig.hresp && before(sig.hresp, t) === 1 ? 'ERROR' : 'OKAY' });
            pend = null;
          }
          const tr = before(sig.htrans, t);
          if (tr === 2 || tr === 3) pend = { t, a: before(sig.haddr, t), w: before(sig.hwrite, t) };
        }
        return out;
      }
    },
    axi4lite: {
      label: 'AXI4-Lite', roles: ['aclk', 'awvalid', 'awready', 'awaddr', 'wvalid', 'wready', 'wdata', 'bvalid', 'bready', 'bresp', 'arvalid', 'arready', 'araddr', 'rvalid', 'rready', 'rdata', 'rresp'], params: {},
      decode(sig) {
        const out = []; const aw = [], w = [], ar = [];
        const hs = (v, r, t) => sig[v] && before(sig[v], t) === 1 && (!sig[r] || before(sig[r], t) === 1);
        for (const t of edges(sig.aclk, true)) {
          if (hs('awvalid', 'awready', t)) aw.push({ t, a: before(sig.awaddr, t) });
          if (hs('wvalid', 'wready', t)) w.push({ t, d: before(sig.wdata, t) });
          if (hs('bvalid', 'bready', t)) { const a = aw.shift() || {}, dd = w.shift() || {}; out.push({ t: a.t || t, t1: t, kind: 'WRITE', addr: hex(a.a, W(sig.awaddr)), data: hex(dd.d, W(sig.wdata)), info: ['OKAY', 'EXOKAY', 'SLVERR', 'DECERR'][sig.bresp ? before(sig.bresp, t) || 0 : 0], error: sig.bresp && before(sig.bresp, t) >= 2 ? 'error response' : '' }); }
          if (hs('arvalid', 'arready', t)) ar.push({ t, a: before(sig.araddr, t) });
          if (hs('rvalid', 'rready', t)) { const a = ar.shift() || {}; out.push({ t: a.t || t, t1: t, kind: 'READ', addr: hex(a.a, W(sig.araddr)), data: hx(sig.rdata, t), info: ['OKAY', 'EXOKAY', 'SLVERR', 'DECERR'][sig.rresp ? before(sig.rresp, t) || 0 : 0] }); }
        }
        return out;
      }
    },
    axis: {
      label: 'AXI-Stream', roles: ['aclk', 'tvalid', 'tready', 'tdata', 'tlast'], params: {},
      decode(sig) {
        const out = []; let pkt = 0, beat = 0;
        for (const t of edges(sig.aclk, true)) {
          if (before(sig.tvalid, t) === 1 && (!sig.tready || before(sig.tready, t) === 1)) {
            const last = sig.tlast && before(sig.tlast, t) === 1;
            out.push({ t, t1: t, kind: last ? 'BEAT (last)' : 'BEAT', data: hx(sig.tdata, t), info: `packet ${pkt} beat ${beat}` });
            beat++; if (last) { pkt++; beat = 0; }
          }
        }
        return out;
      }
    },
    wishbone: {
      label: 'Wishbone', roles: ['clk', 'cyc', 'stb', 'we', 'adr', 'dat_w', 'dat_r', 'ack'], params: {},
      decode(sig) {
        const out = [];
        for (const t of edges(sig.clk, true)) {
          if (before(sig.cyc, t) === 1 && before(sig.stb, t) === 1 && before(sig.ack, t) === 1) {
            const w = before(sig.we, t) === 1;
            out.push({ t, t1: t, kind: w ? 'WRITE' : 'READ', addr: hx(sig.adr, t), data: w ? hx(sig.dat_w, t) : hx(sig.dat_r, t), info: '' });
          }
        }
        return out;
      }
    },
    spiflash: {
      label: 'SPI-Flash (on SPI)', roles: ['sclk', 'mosi', 'miso', 'cs_n'], params: { cpol: 0, cpha: 0, addrBytes: 3 },
      decode(sig, p) {
        // one transaction per chip-select frame: opcode, address, dummy bytes, then data (MOSI for writes, MISO for reads)
        const frames = spiFrames(sig, p);
        const out = [];
        let wel = false;
        for (const f of frames) {
          if (!f.mo.length) continue;
          const op = f.mo[0];
          const c = FLASH_OPS[op] || { n: 'UNKNOWN', a: 0, d: 0, dir: '' };
          const ab = c.a === 'A' ? Number(p.addrBytes) || 3 : c.a;
          let addr = null;
          if (ab && f.mo.length >= 1 + ab) { addr = 0; for (let k = 1; k <= ab; k++) addr = addr * 256 + f.mo[k]; }
          const from = 1 + ab + (c.d || 0);
          const data = (c.dir === 'r' ? f.mi : f.mo).slice(from);
          const hexs = data.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join(' ') + (data.length > 16 ? ` … (+${data.length - 16})` : '');
          let info = `${data.length} data byte(s)`, error = '';
          if (op === 0x05 && data.length) { const s = data[data.length - 1]; info = `status 0x${s.toString(16).padStart(2, '0')}: WIP=${s & 1} WEL=${(s >> 1) & 1}`; }
          if (op === 0x9f && data.length >= 3) info = `JEDEC ID manufacturer 0x${data[0].toString(16)} type 0x${data[1].toString(16)} capacity 0x${data[2].toString(16)}`;
          if (c.n === 'UNKNOWN') error = `unknown opcode 0x${op.toString(16).padStart(2, '0')}`;
          if (c.needsWel && !wel) error = error || 'WREN (0x06) was not sent before this command: the flash will ignore it';
          if (ab && addr == null) error = error || 'frame ended before the address was complete';
          if (op === 0x06) wel = true; else if (op === 0x04 || c.needsWel) wel = false;
          out.push({ t: f.t0, t1: f.t1, kind: c.n, addr: addr == null ? '' : hex(addr, ab * 8), data: hexs, info: `op 0x${op.toString(16).padStart(2, '0')} · ` + info, error });
        }
        return out;
      }
    },
    riscv: {
      label: 'RISC-V instruction trace', roles: ['clk', 'valid', 'pc', 'insn'], params: { edge: 'rising' },
      decode(sig, p) {
        // one row per retired instruction: sampled on the clock edge when valid is 1 (or every edge if valid is unmapped)
        const out = [];
        const ts = sig.clk ? edges(sig.clk, p.edge !== 'falling') : (sig.pc ? sig.pc.t.slice() : []);
        let prev = null;
        for (const t of ts) {
          if (sig.valid && before(sig.valid, t) !== 1) continue;
          const pc = sig.pc ? before(sig.pc, t) : null, ins = sig.insn ? before(sig.insn, t) : null;
          if (ins == null) continue;
          const d = rvDisasm(ins >>> 0, pc);
          if (prev && prev.d.flow && pc != null) {
            const fall = (prev.pc + prev.d.len) >>> 0;
            prev.row.info += pc !== fall ? `  → taken to ${hex(pc, 32)}` : '  (not taken)';
          }
          const row = { t, t1: t, kind: d.cls, addr: pc == null ? '' : hex(pc >>> 0, 32), data: hex(ins >>> 0, d.len === 2 ? 16 : 32), info: d.text, error: d.illegal ? 'illegal / unsupported instruction' : '' };
          out.push(row);
          prev = { pc, d, row };
        }
        return out;
      }
    },
    handshake: {
      label: 'valid/ready handshake', roles: ['clk', 'valid', 'ready', 'data'], params: {},
      decode(sig) {
        const out = []; let stall = 0;
        for (const t of edges(sig.clk, true)) {
          const v = before(sig.valid, t), r = sig.ready ? before(sig.ready, t) : 1;
          if (v === 1 && r === 1) { out.push({ t, t1: t, kind: 'XFER', data: hx(sig.data, t), info: stall ? `after ${stall} stall cycle(s)` : '' }); stall = 0; }
          else if (v === 1) stall++;
        }
        return out;
      }
    }
  };

  /** guess role -> signal mapping from names */
  function guessRoles(proto, names) {
    const roles = DECODERS[proto].roles;
    const map = {};
    const low = names.map(n => ({ n, l: n.toLowerCase().replace(/\[.*$/, '').split('.').pop() }));
    const alias = { pc: ['pc', 'rvfi_pc_rdata', 'pc_o', 'retire_pc', 'wb_pc', 'trace_pc'], insn: ['insn', 'instr', 'inst', 'rvfi_insn', 'instruction', 'retire_insn', 'wb_insn', 'trace_insn'], valid: ['valid', 'rvfi_valid', 'retire', 'retire_valid', 'instret', 'commit', 'trace_valid'], rx: ['rx', 'uart_rx', 'txd', 'tx', 'rxd', 'serial'], sclk: ['sclk', 'sck', 'spi_clk', 'clk'], mosi: ['mosi', 'sdi', 'copi'], miso: ['miso', 'sdo', 'cipo'], cs_n: ['cs_n', 'csn', 'ss_n', 'ssn', 'cs', 'ss'], scl: ['scl'], sda: ['sda'], dat_w: ['dat_w', 'dat_i', 'wdata'], dat_r: ['dat_r', 'dat_o', 'rdata'] };
    for (const r of roles) {
      const cands = (alias[r] || [r]).concat(['i_' + r, r + '_i', 'o_' + r, r + '_o', 's_axi_' + r, 'm_axi_' + r, 's_axis_' + r, 'm_axis_' + r]);
      const hit = low.find(x => cands.includes(x.l)) || low.find(x => x.l.endsWith('_' + r) || x.l.endsWith(r));
      if (hit) map[r] = hit.n;
    }
    return map;
  }

  /* --------------------------------------------------------------- multi-signal pattern search */
  /** compile "valid && ready && data == 8'hFF" into a predicate over a value lookup; names resolved by resolve(name) -> signal key */
  /* precedence-climbing parser → closure tree (no eval/new Function: webviews forbid unsafe-eval) */
  const BIN = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
  const UNKNOWN = { unknown: true };
  function compileExpr(expr, resolve) {
    const toks = (expr.match(/\d+'[sS]?[bBoOdDhH][0-9a-fA-F_xXzZ]+|'[bBoOdDhH][0-9a-fA-F_]+|0x[0-9a-fA-F_]+|0b[01_]+|\d+|[A-Za-z_][\w.\[\]:$]*|==|!=|<=|>=|<<|>>|&&|\|\||[<>()!&|^~+\-*\/%]|\s+|./g) || []).filter(t => !/^\s+$/.test(t));
    const bad = toks.find(t => !/^(\d|'|0x|0b|[A-Za-z_]|==|!=|<=|>=|<<|>>|&&|\|\||[<>()!&|^~+\-*\/%])/.test(t));
    if (bad) throw new Error(`unexpected '${bad}' in: ${expr}`);
    const keys = [];
    let i = 0;
    const peek = () => toks[i];
    function primary() {
      const tk = toks[i++];
      if (tk == null) throw new Error('expression ends too early');
      let m;
      if (tk === '(') { const e = binary(0); if (toks[i++] !== ')') throw new Error("missing ')'"); return e; }
      if (tk === '!' || tk === '~' || tk === '-') {
        const a = primary();
        return tk === '!' ? V => { const x = a(V); return x === UNKNOWN ? UNKNOWN : (x ? 0 : 1); }
          : tk === '~' ? V => { const x = a(V); return x === UNKNOWN ? UNKNOWN : ~x; } : V => { const x = a(V); return x === UNKNOWN ? UNKNOWN : -x; };
      }
      if ((m = /^(\d+)?'[sS]?([bBoOdDhH])([0-9a-fA-F_]+)$/.exec(tk))) { const n = parseInt(m[3].replace(/_/g, ''), { b: 2, o: 8, d: 10, h: 16 }[m[2].toLowerCase()]); return () => n; }
      if (/^0x/i.test(tk)) { const n = parseInt(tk.slice(2).replace(/_/g, ''), 16); return () => n; }
      if (/^0b/i.test(tk)) { const n = parseInt(tk.slice(2).replace(/_/g, ''), 2); return () => n; }
      if (/^\d+$/.test(tk)) { const n = Number(tk); return () => n; }
      if (/^[A-Za-z_]/.test(tk)) {
        const k = resolve(tk);
        if (k == null) throw new Error(`unknown signal '${tk}' (add it to the waveform first)`);
        keys.push(k);
        return V => { const x = V(k); return x == null ? UNKNOWN : x; };
      }
      throw new Error(`unexpected '${tk}'`);
    }
    function binary(minP) {
      let left = primary();
      while (peek() != null && BIN[peek()] != null && BIN[peek()] > minP) {
        const op = toks[i++], p = BIN[op];
        const right = binary(p);
        const l = left;
        left = V => {
          const a = l(V);
          if (op === '&&') { if (a !== UNKNOWN && !a) return 0; const b = right(V); return a === UNKNOWN || b === UNKNOWN ? (b === 0 ? 0 : UNKNOWN) : (b ? 1 : 0); }
          if (op === '||') { if (a !== UNKNOWN && a) return 1; const b = right(V); return a === UNKNOWN || b === UNKNOWN ? (b && b !== UNKNOWN ? 1 : UNKNOWN) : (b ? 1 : 0); }
          const b = right(V);
          if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN;
          switch (op) {
            case '|': return a | b; case '^': return a ^ b; case '&': return a & b;
            case '==': return a === b ? 1 : 0; case '!=': return a !== b ? 1 : 0;
            case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0; case '<=': return a <= b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
            case '<<': return a * Math.pow(2, b); case '>>': return Math.floor(a / Math.pow(2, b));
            case '+': return a + b; case '-': return a - b; case '*': return a * b;
            case '/': return b ? Math.floor(a / b) : UNKNOWN; default: return b ? a % b : UNKNOWN;
          }
        };
      }
      return left;
    }
    const root = binary(0);
    if (i < toks.length) throw new Error(`unexpected '${toks[i]}' after a complete expression`);
    return { keys: [...new Set(keys)], test: V => { const r = root(V); return r !== UNKNOWN && !!r; } };
  }
  /** find the start times of intervals where the predicate is true */
  function search(expr, sigByKey, resolve, limit) {
    const c = compileExpr(expr, resolve);
    const times = [...new Set(c.keys.flatMap(k => sigByKey[k].t))].sort((a, b) => a - b);
    const hits = [];
    let prev = false;
    for (const t of times) {
      const ok = c.test(k => num(valAt(sigByKey[k], t)));
      if (ok && !prev) { hits.push(t); if (hits.length >= (limit || 5000)) break; }
      prev = ok;
    }
    return hits;
  }

  /* --------------------------------------------------------------- switching activity */
  function popcount(a, b) { let c = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) c++; return c; }
  function activity(sig, t0, t1) {
    let toggles = 0, changes = 0;
    for (let k = 1; k < sig.t.length; k++) {
      if (sig.t[k] < t0 || sig.t[k] > t1) continue;
      changes++;
      toggles += popcount(sig.v[k - 1], sig.v[k]);
    }
    return { toggles, changes };
  }

  /* --------------------------------------------------------------- X-trace */
  /** for a signal that is X at time t: when did it become X, and which other signals were X/Z at or before that time */
  function xtrace(target, others, t) {
    const k = idxAt(target.sig, t);
    if (k < 0 || isKnown(target.sig.v[k])) return { isX: false };
    let s = k;
    while (s > 0 && !isKnown(target.sig.v[s - 1])) s--;
    const since = target.sig.t[s];
    const cands = [];
    for (const o of others) {
      const j = idxAt(o.sig, since);
      if (j < 0 || isKnown(o.sig.v[j])) continue;
      let a = j;
      while (a > 0 && !isKnown(o.sig.v[a - 1])) a--;
      cands.push({ name: o.name, since: o.sig.t[a], value: o.sig.v[j] });
    }
    cands.sort((a, b) => a.since - b.since);
    return { isX: true, since, value: target.sig.v[k], candidates: cands };
  }

  /* --------------------------------------------------------------- value formatting helpers shared with the viewer */
  function toFloat(bits) {
    if (bits.length === 32) { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, parseInt(bits, 2)); return b.getFloat32(0); }
    if (bits.length === 64) { const b = new DataView(new ArrayBuffer(8)); b.setBigUint64(0, BigInt('0b' + bits)); return b.getFloat64(0); }
    if (bits.length === 16) { const h = parseInt(bits, 2); const s = h >> 15 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; return e === 0 ? s * Math.pow(2, -14) * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + f / 1024); }
    return null;
  }
  function toUtf8(bits) {
    const p = '0'.repeat((8 - bits.length % 8) % 8) + bits;
    const bytes = [];
    for (let i = 0; i < p.length; i += 8) bytes.push(parseInt(p.slice(i, i + 8), 2));
    try { return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes)).replace(/\0/g, ''); } catch (e) { return ''; }
  }

  /* --------------------------------------------------------------- colour contrast (WCAG 2.x) */
  function parseColor(c) {
    c = String(c || '').trim();
    let m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
    if (m) { let h = m[1]; if (h.length === 3) h = h.split('').map(x => x + x).join(''); const n = parseInt(h, 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(c);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function luminance(rgb) { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); }
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  /** return colour c, moved towards black or white just far enough to reach `min` contrast against bg */
  function ensureContrast(c, bg, min) {
    const a = parseColor(c), b = parseColor(bg);
    if (!a || !b || contrast(a, b) >= min) return c;
    const to = luminance(b) > 0.5 ? [0, 0, 0] : [255, 255, 255];
    for (let k = 1; k <= 20; k++) {
      const f = k / 20, m = a.map((v, i) => Math.round(v + (to[i] - v) * f));
      if (contrast(m, b) >= min) return '#' + m.map(v => v.toString(16).padStart(2, '0')).join('');
    }
    return '#' + to.map(v => v.toString(16).padStart(2, '0')).join('');
  }

  return { DECODERS, guessRoles, search, compileExpr, activity, xtrace, idxAt, valAt, num, isKnown, toFloat, toUtf8, edges, rvDisasm, spiFrames, ensureContrast, contrast, parseColor };
});

// ../../node_modules/qoa-format/lib/common.js
var QOA_SLICE_LEN = 20;
var QOA_SLICES_PER_FRAME = 256;
var QOA_FRAME_LEN = QOA_SLICES_PER_FRAME * QOA_SLICE_LEN;
var QOA_LMS_LEN = 4;
var QOA_MAGIC = 1903124838;
function qoa_clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
function LMS(h, w) {
  const history = new Int16Array(h || 4);
  const weights = new Int16Array(w || 4);
  return { history, weights };
}
function qoa_lms_predict(weights, history) {
  return weights[0] * history[0] + weights[1] * history[1] + weights[2] * history[2] + weights[3] * history[3] >> 13;
}
function qoa_lms_update(weights, history, sample, residual) {
  let delta = residual >> 4;
  weights[0] += history[0] < 0 ? -delta : delta;
  weights[1] += history[1] < 0 ? -delta : delta;
  weights[2] += history[2] < 0 ? -delta : delta;
  weights[3] += history[3] < 0 ? -delta : delta;
  history[0] = history[1];
  history[1] = history[2];
  history[2] = history[3];
  history[3] = sample;
}
var qoa_round = (num) => Math.sign(num) * Math.round(Math.abs(num));
var qoa_scalefactor_tab = Array(16).fill().map((_, s) => qoa_round(Math.pow(s + 1, 2.75)));
var dqt = [0.75, -0.75, 2.5, -2.5, 4.5, -4.5, 7, -7];
var qoa_dequant_tab = qoa_scalefactor_tab.map((sf) => {
  return dqt.map((dq) => qoa_round(dq * sf));
});

// src/decode-qoa.src.js
var EMPTY = Object.freeze({ channelData: [], sampleRate: 0 });
function decodeQoa(src) {
  let out = decoder().decode(src instanceof Uint8Array ? src : new Uint8Array(src));
  if (!out.channelData.length) throw new Error("QOA: no complete frame");
  return out;
}
function decoder() {
  let buf = new Uint8Array(0), header = false, total = 0, done = 0, rate = 0;
  return {
    decode(chunk) {
      if (!chunk?.byteLength) return EMPTY;
      if (!(chunk instanceof Uint8Array)) chunk = new Uint8Array(chunk.buffer ?? chunk, chunk.byteOffset ?? 0, chunk.byteLength);
      buf = buf.length ? concat(buf, chunk) : chunk;
      let out = [], p = 0;
      if (!header) {
        if (buf.length < 8) return EMPTY;
        let dv = new DataView(buf.buffer, buf.byteOffset);
        if (dv.getUint32(0) !== QOA_MAGIC) throw new Error("Not a QOA file; expected magic number 'qoaf'");
        total = dv.getUint32(4);
        header = true;
        p = 8;
      }
      while (p + 8 <= buf.length && (!total || done < total)) {
        let size = buf[p + 6] << 8 | buf[p + 7];
        if (size < 8 || p + size > buf.length) break;
        let f = frame(buf, p, size);
        rate = f.sampleRate;
        if (total && done + f.samples > total) f.channelData = f.channelData.map((c) => c.subarray(0, total - done));
        done += f.channelData[0].length;
        out.push(f.channelData);
        p += size;
      }
      buf = buf.subarray(p);
      if (!out.length) return EMPTY;
      return { channelData: out.length === 1 ? out[0] : out[0].map((_, c) => join(out.map((o) => o[c]))), sampleRate: rate };
    },
    flush: () => EMPTY,
    free() {
      buf = new Uint8Array(0);
    }
  };
}
function frame(b, p, size) {
  let channels = b[p], sampleRate = b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3], samples = b[p + 4] << 8 | b[p + 5];
  let slices = Math.floor((size - 8 - QOA_LMS_LEN * 4 * channels) / 8);
  if (!channels || samples * channels > slices * QOA_SLICE_LEN) throw new Error("QOA: invalid frame header data");
  let dv = new DataView(b.buffer, b.byteOffset + p), o = 8, lmses = [];
  for (let c = 0; c < channels; c++) {
    let lms = LMS();
    for (let i = 0; i < QOA_LMS_LEN; i++, o += 2) lms.history[i] = dv.getInt16(o);
    for (let i = 0; i < QOA_LMS_LEN; i++, o += 2) lms.weights[i] = dv.getInt16(o);
    lmses.push(lms);
  }
  let channelData = Array.from({ length: channels }, () => new Float32Array(samples));
  for (let s = 0; s < samples; s += QOA_SLICE_LEN) {
    for (let c = 0; c < channels; c++, o += 8) {
      let hi = dv.getUint32(o), lo = dv.getUint32(o + 4), table = qoa_dequant_tab[hi >>> 28];
      let { weights, history } = lmses[c], out = channelData[c], n = Math.min(QOA_SLICE_LEN, samples - s);
      for (let i = 0; i < n; i++) {
        let sh = 57 - 3 * i;
        let q = sh >= 32 ? hi >>> sh - 32 & 7 : sh + 3 <= 32 ? lo >>> sh & 7 : (hi << 32 - sh | lo >>> sh) & 7;
        let predicted = qoa_lms_predict(weights, history), dequantized = table[q];
        let r = qoa_clamp(predicted + dequantized, -32768, 32767);
        out[s + i] = r < 0 ? r / 32768 : r / 32767;
        qoa_lms_update(weights, history, r, dequantized);
      }
    }
  }
  return { channelData, sampleRate, samples };
}
function concat(a, b) {
  let o = new Uint8Array(a.length + b.length);
  o.set(a);
  o.set(b, a.length);
  return o;
}
function join(parts) {
  let n = 0;
  for (let p of parts) n += p.length;
  let o = new Float32Array(n);
  n = 0;
  for (let p of parts) {
    o.set(p, n);
    n += p.length;
  }
  return o;
}
export {
  decoder,
  decodeQoa as default
};

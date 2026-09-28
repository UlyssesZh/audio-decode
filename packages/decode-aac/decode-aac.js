/**
 * AAC decoder — FAAD2 compiled to WASM
 * Decodes M4A (MP4/AAC) and raw ADTS streams. M4A files carrying ALAC
 * (Apple Lossless) are decoded by the pure-JS ALAC decoder instead.
 *
 * let { channelData, sampleRate } = await decode(m4abuf)
 */

import { createALAC } from './alac.js'
import createAAC from './src/aac.wasm.js'

let _modP

async function getMod() {
	if (_modP) return _modP
	let p = createAAC()
	_modP = p
	try { return await p }
	catch (e) { _modP = null; throw e }
}

/**
 * Whole-file decode
 * @param {Uint8Array|ArrayBuffer} src
 * @returns {Promise<{channelData: Float32Array[], sampleRate: number}>}
 */
export default async function decode(src) {
	let buf = src instanceof Uint8Array ? src : new Uint8Array(src)
	let dec = await decoder()
	try {
		return dec.decode(buf)
	} finally {
		dec.free()
	}
}

/**
 * Create decoder instance.
 * Without options the decoder auto-detects M4A vs ADTS from the byte stream.
 * With `asc` (AudioSpecificConfig) or `alac` (ALAC magic cookie) it decodes raw access
 * units delivered out-of-band by a container demuxer (MP4, Matroska, AVI): each decode()
 * call takes one complete frame, or an array of frames.
 * `gapless` ({ start, duration } seconds of the media timeline, gapless() from the container's boxes)
 * trims the encoder's priming and padding: the output starts at `start` and lasts `duration`.
 * @param {{ asc?: Uint8Array, alac?: Uint8Array, gapless?: { start: number, duration?: number } }} [opts]
 * @returns {Promise<{decode(chunk: Uint8Array | Uint8Array[]): {channelData, sampleRate}, flush(), free()}>}
 */
export async function decoder(opts) {
	let dec = new AACDecoder(await getMod())
	if (opts?.asc) { dec._initASC(opts.asc); dec._raw = true }
	else if (opts?.alac) { dec._initALAC(opts.alac); dec._raw = true }
	if (dec._raw && opts.gapless) dec._window(opts.gapless)
	return dec
}

const EMPTY = Object.freeze({ channelData: [], sampleRate: 0 })

class AACDecoder {
	constructor(mod) {
		this.m = mod
		this.h = null
		this.sr = 0
		this.ch = 0
		this.done = false
		this._ptr = 0
		this._cap = 0
		this._left = null
		this._fileOff = 0     // absolute file offset of _left[0] (M4A streaming)
		this._skip = 0        // bytes to discard from incoming data (M4A streaming, when next frame is past _left)
		this._m4a = null      // M4A streaming iterator: { sizes, stco, stsc, idx, ci, sInC, spc, nextOff }
		this._accum = null    // Uint8Array[] — M4A header accumulator
		this._accumLen = 0
		this._alac = null     // ALAC decoder when the M4A carries Apple Lossless
		this._raw = false     // raw access units (config given up-front)
		this._gap = null      // gapless trim: { skip, left } output samples (_window)
		this._core = 0        // the AudioSpecificConfig's own rate (half the output's with SBR)
	}

	decode(data) {
		if (this.done) throw Error('Decoder already freed')
		if (this._raw) {
			let frames = (Array.isArray(data) ? data : [data]).filter(f => f?.byteLength).map(f => f instanceof Uint8Array ? f : new Uint8Array(f))
			return frames.length ? this._trim(this._feedFrames(frames)) : EMPTY
		}
		if (!data || !data.byteLength) return EMPTY

		let buf = data instanceof Uint8Array ? data : new Uint8Array(data)

		if (this._m4a) return this._feedM4AData(buf)
		if (this.h) return this._decodeADTS(buf)
		// M4A: accumulating moov+mdat header, or first chunk starts with ftyp
		if (this._accum || (buf.length > 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70)) {
			(this._accum ??= []).push(buf)
			this._accumLen += buf.length
			return this._tryM4AInit()
		}
		return this._decodeADTS(buf)
	}

	flush() {
		this._left = null
		return EMPTY
	}

	free() {
		if (this.done) return
		this.done = true
		if (this.h) {
			this.m._aac_close(this.h)
			this.m._aac_free_buf()
			this.h = null
		}
		if (this._ptr) {
			this.m._free(this._ptr)
			this._ptr = 0
			this._cap = 0
		}
		this._accum = null; this._accumLen = 0
		this._m4a = null; this._left = null; this._alac = null
		this._fileOff = 0; this._skip = 0
	}

	_catAccum() {
		if (this._accum.length === 1) return this._accum[0]
		let buf = new Uint8Array(this._accumLen), off = 0
		for (let c of this._accum) { buf.set(c, off); off += c.length }
		return buf
	}

	_tryM4AInit() {
		let buf = this._catAccum()
		// tables are collected per trak — a second non-audio track (e.g. a QuickTime
		// chapter/text track, github #48) must not clobber the audio track's tables
		let traks = [], t = null, moov = false, mvhd = null, smpb = null

		parseBoxes(buf, 0, buf.length, (type, data) => {
			if (type === 'moov') moov = true
			else if (type === 'mvhd') mvhd = data
			else if (type === 'ilst') smpb = data
			else if (type === 'trak') traks.push(t = {})
			else if (!t) return
			else if (type === 'esds') t.asc = parseEsds(data)
			else if (type === 'alac') t.alacCookie = data // ALAC magic cookie: version/flags(4) + ALACSpecificConfig(24)
			else if (type === 'stsz') t.stsz = parseStsz(data)
			else if (type === 'stco') t.stco = parseStco(data)
			else if (type === 'co64') t.stco = parseCo64(data)
			else if (type === 'stsc') t.stsc = parseStsc(data)
			else if (type === 'mdhd' || type === 'elst' || type === 'stts') t[type] = data
		})

		// the audio track: first trak with an audio config + sample tables
		let track = traks.find(t => (t.asc || t.alacCookie) && t.stsz && t.stco?.length) ?? {}
		let { asc, alacCookie, stsz, stco, stsc } = track
		if ((!asc && !alacCookie) || !stsz || !stco?.length) {
			// the whole moov is here and still no AAC/ALAC track — other codecs live in @audio/decode-mp4
			if (moov) throw Error('No AAC/ALAC audio track in MP4')
			return EMPTY // moov/tables not ready
		}

		if (alacCookie) this._initALAC(alacCookie)
		else this._initASC(asc)
		let g = gapless({ elst: track.elst, mdhd: track.mdhd, stts: track.stts, mvhd, ilst: smpb, asc, alac: alacCookie })
		if (g) this._window(g)

		// Streaming: walk sample tables by absolute file offset so chunk boundaries are irrelevant.
		this._accum = null; this._accumLen = 0
		this._m4a = { sizes: stsz, stco, stsc, idx: 0, ci: 0, sInC: 0, spc: spcAt(0, stsc), nextOff: stco[0] }
		this._left = buf
		this._fileOff = 0
		this._skip = 0
		return this._extractM4A()
	}

	// ALAC (Apple Lossless) — pure JS, no FAAD2. Cookie: 24-byte ALACSpecificConfig, optionally
	// preceded by version/flags (MP4 `alac` box body, 28) or the whole atom (ffmpeg extradata, 36).
	_initALAC(cookie) {
		this._alac = createALAC(cookie.subarray(cookie.length - 24))
		this.sr = this._alac.config.sampleRate
		this.ch = this._alac.config.numChannels
	}

	// Init WASM decoder with AudioSpecificConfig
	_initASC(asc) {
		let m = this.m, h = m._aac_create()
		let srP = m._aac_sr_ptr(), chP = m._aac_ch_ptr()
		let ptr = this._alloc(asc.length)
		m.HEAPU8.set(asc, ptr)
		let err = m._aac_init2(h, ptr, asc.length, srP, chP)
		if (err < 0) { m._aac_close(h); throw Error('AAC init failed (code ' + err + ')') }
		this.sr = m.getValue(srP, 'i32')
		this.ch = m.getValue(chP, 'i8')
		if (!this.ch) { m._aac_close(h); throw Error('AAC init: no channels in ASC') }
		this.h = h
		this._core = ascRate(asc) || this.sr
		this._order = AAC_ORDER[(asc[1] >> 3) & 15]
	}

	_feedM4AData(buf) {
		if (this._skip > 0) {
			let n = Math.min(this._skip, buf.length)
			this._skip -= n
			this._fileOff += n
			buf = buf.subarray(n)
			if (!buf.length) return EMPTY
		}
		this._left = append(this._left, buf)
		return this._extractM4A()
	}

	_extractM4A() {
		let st = this._m4a, frames = []
		while (st.idx < st.sizes.length) {
			let off = st.nextOff, sz = st.sizes[st.idx]
			let bufOff = off - this._fileOff
			if (bufOff + sz > this._left.length) break
			if (bufOff >= 0) frames.push(this._left.subarray(bufOff, bufOff + sz))
			advanceM4A(st)
		}

		if (st.idx < st.sizes.length) {
			let nextOff = st.nextOff, end = this._fileOff + this._left.length
			if (nextOff >= end) {
				this._skip = nextOff - end
				this._fileOff = end
				this._left = null
			} else if (nextOff > this._fileOff) {
				this._left = this._left.subarray(nextOff - this._fileOff).slice()
				this._fileOff = nextOff
			}
		} else {
			this._left = null
		}

		return frames.length ? this._trim(this._feedFrames(frames)) : EMPTY
	}

	// The presentation window in output samples. FAAD2 withholds its first frame (1024 samples, 2048 with
	// SBR), so its output starts that far into the media; SBR's QMF filterbanks delay it by 962 samples (the
	// offset of Apple's HE-AAC against its source). ALAC has no delay.
	_window({ start = 0, duration }) {
		let sbr = this.sr > this._core * 1.5 ? 2 : 1, offset = this._alac ? 0 : 1024 * sbr - (sbr > 1 ? SBR_DELAY : 0)
		this._gap = { skip: Math.max(0, Math.round(start * this.sr) - offset), left: duration == null ? null : Math.round(duration * this.sr) }
	}

	// drop the priming, stop at the presentation's end
	_trim(r) {
		let g = this._gap
		if (!g || !r.channelData.length) return r
		let n = r.channelData[0].length, a = Math.min(n, g.skip), b = g.left == null ? n : Math.min(n, a + g.left)
		g.skip -= a
		if (g.left != null) g.left -= b - a
		if (b <= a) return EMPTY
		return a || b < n ? { ...r, channelData: r.channelData.map(c => c.subarray(a, b)) } : r
	}

	_alloc(len) {
		if (len > this._cap) {
			if (this._ptr) this.m._free(this._ptr)
			this._cap = len
			this._ptr = this.m._malloc(len)
		}
		return this._ptr
	}

	_decodeADTS(buf) {
		let m = this.m

		if (this._left) { buf = append(this._left, buf); this._left = null }

		if (!this.h) {
			if (buf.length < 7) { this._left = buf.slice(); return EMPTY }
			let h = m._aac_create()
			let srP = m._aac_sr_ptr(), chP = m._aac_ch_ptr()
			let ptr = this._alloc(buf.length)
			m.HEAPU8.set(buf, ptr)
			let consumed = m._aac_init(h, ptr, buf.length, srP, chP)
			if (consumed < 0) { m._aac_close(h); throw Error('ADTS init failed (code ' + consumed + ')') }
			let a = adtsAt(buf)  // the first ADTS header: channel_configuration spans bytes 2 and 3
			if (a >= 0) this._order = AAC_ORDER[((buf[a + 2] & 1) << 2) | (buf[a + 3] >> 6)]
			this.sr = m.getValue(srP, 'i32')
			this.ch = m.getValue(chP, 'i8')
			if (!this.ch) {
				// not enough data to detect channels — buffer for next call
				m._aac_close(h)
				this._left = buf.length < 8192 ? buf.slice() : null
				return EMPTY
			}
			this.h = h
			buf = buf.subarray(consumed)
		}

		// extract complete ADTS frames only — never feed partial data to FAAD2
		let frames = [], pos = 0
		while (pos + 6 < buf.length) {
			if (buf[pos] !== 0xFF || (buf[pos + 1] & 0xF6) !== 0xF0) { pos++; continue }
			let flen = ((buf[pos + 3] & 0x03) << 11) | (buf[pos + 4] << 3) | (buf[pos + 5] >> 5)
			if (flen < 7 || pos + flen > buf.length) break
			frames.push(buf.subarray(pos, pos + flen))
			pos += flen
		}

		if (pos < buf.length) {
			let left = buf.subarray(pos)
			this._left = left.length < 8192 ? left.slice() : null
		}

		if (!frames.length) return EMPTY
		return this._feedFrames(frames)
	}

	_feedFrames(frames) {
		if (this._alac) return this._feedALAC(frames)
		let m = this.m, h = this.h
		let chunks = [], totalPerCh = 0, channels = this.ch, errors = 0

		for (let frame of frames) {
			let ptr = this._alloc(frame.length)
			m.HEAPU8.set(frame, ptr)
			let out = m._aac_decode(h, ptr, frame.length)
			if (!out) { errors++; continue }

			let n = m._aac_samples()
			let sr = m._aac_samplerate()
			if (sr) this.sr = sr
			let ch = m._aac_channels()
			if (ch) channels = ch

			let spc = n / channels
			chunks.push({ data: new Float32Array(m.HEAPF32.buffer, out, n).slice(), ch: channels, spc })
			totalPerCh += spc
		}

		if (!totalPerCh) return EMPTY

		let channelData = Array.from({ length: channels }, () => new Float32Array(totalPerCh))
		let pos = 0
		for (let { data, ch, spc } of chunks) {
			let order = ch === this._order?.length ? this._order : null
			for (let c = 0; c < ch; c++) {
				let out = channelData[c], k = order ? order[c] : c
				for (let s = 0; s < spc; s++) out[pos + s] = data[s * ch + k]
			}
			pos += spc
		}

		return { channelData, sampleRate: this.sr, errors }
	}

	_feedALAC(frames) {
		let channels = this.ch, parts = [], total = 0
		for (let frame of frames) {
			let r = this._alac.decodeFrame(frame)
			parts.push(r.channelData)
			total += r.numSamples
		}
		if (!total) return EMPTY
		let channelData = Array.from({ length: channels }, () => new Float32Array(total))
		let pos = 0
		for (let cd of parts) {
			let n = cd[0].length
			for (let c = 0; c < channels; c++) channelData[c].set(cd[c], pos)
			pos += n
		}
		return { channelData, sampleRate: this.sr }
	}
}


// The first ADTS header (ISO/IEC 14496-3 Annex 1.A): past an ID3v2 tag by its size, a 12-bit 0xFFF sync with layer 00,
// and the next frame's sync where its length points, when the buffer holds it: a 0xFF inside a tag is no header
function adtsAt(buf) {
	let p = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33 && buf.length >= 10
		? 10 + ((buf[6] & 0x7F) << 21 | (buf[7] & 0x7F) << 14 | (buf[8] & 0x7F) << 7 | buf[9] & 0x7F) + (buf[5] & 0x10 ? 10 : 0) : 0
	const sync = i => buf[i] === 0xFF && (buf[i + 1] & 0xF6) === 0xF0
	for (; p + 7 <= buf.length; p++) {
		if (!sync(p)) continue
		let n = p + ((buf[p + 3] & 3) << 11 | buf[p + 4] << 3 | buf[p + 5] >> 5)
		if (n >= p + 7 && (n + 2 > buf.length || sync(n))) return p
	}
	return -1
}


// ===== M4A demuxer =====

function append(left, buf) {
	if (!left?.length) return buf.slice()
	let merged = new Uint8Array(left.length + buf.length)
	merged.set(left); merged.set(buf, left.length)
	return merged
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta', 'edts', 'sinf'])

function parseBoxes(buf, start, end, cb) {
	let off = start
	while (off < end - 8) {
		let size = r32(buf, off)
		let type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7])

		if (size === 0) size = end - off
		else if (size === 1 && off + 16 <= end) {
			size = r32(buf, off + 12)
			if (size < 16) break
		} else if (size < 8) break

		// skip mdat fast — the raw frames don't interest us here
		if (type === 'mdat') { off += size; continue }
		// truncated non-mdat box: tables would be garbage — wait for more data
		if (off + size > end) break

		let bodyOff = off + 8
		if (type === 'stsd') parseSampleDesc(buf, bodyOff, size - 8, cb)
		else if (CONTAINERS.has(type)) {
			if (type === 'trak') cb(type, null) // track boundary — tables that follow belong to this trak
			parseBoxes(buf, bodyOff + (type === 'meta' ? 4 : 0), off + size, cb)
			if (type === 'moov') cb(type, null) // whole moov parsed — tables are final
		}
		else cb(type, buf.subarray(bodyOff, off + size))

		off += size
	}
}

function parseSampleDesc(buf, off, len, cb) {
	let entries = r32(buf, off + 4), pos = off + 8
	for (let i = 0; i < entries && pos < off + len; i++) {
		let eSize = r32(buf, pos)
		let eType = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7])
		// recurse into the audio sample entry so its child boxes (esds for AAC, alac cookie for ALAC) surface.
		// QuickTime sound description versions: v0 = 36-byte header, v1 adds 16 bytes, v2 declares its own size.
		if (eType === 'mp4a' || eType === 'alac') {
			let ver = (buf[pos + 16] << 8) | buf[pos + 17]
			let head = ver === 1 ? 52 : ver === 2 ? r32(buf, pos + 36) : 36
			if (eSize > head) parseBoxes(buf, pos + head, pos + eSize, cb)
		}
		pos += eSize
	}
}

// Gapless: the presentation window of an MP4 audio track, { start, duration } in seconds of the media timeline
// (null without gapless information). From the edit list (ISO/IEC 14496-12 §8.6.6): its one media edit's media_time
// is where the presentation starts, past the encoder's priming; its length is the media's (stts) past that
// start, capped by the edit's duration to within the movie timescale's tick (ffmpeg writes whole milliseconds,
// floored); a duration of 0 leaves it open (§8.6.6: the edit runs to the media's end). Else iTunes' iTunSMPB tag (Apple's encoders): priming and length in samples at the codec's own rate
// (the AudioSpecificConfig's, half the output's with SBR; ALAC's cookie's). The codec then drops its own delay
// (decoder({ gapless })). Boxes are their bodies; `asc` or `alac` is the track's codec config.
export function gapless({ elst, mdhd, stts, mvhd, ilst, asc, alac }) {
	let rate = asc ? ascRate(asc) : alac?.length >= 24 ? r32(alac, alac.length - 4) : 0
	let edits = mediaEdits(elst), edit = edits[0], ts = mdhd ? timescale(mdhd) : 0
	// several media edits cut or repeat the media: no window of it presents them, so it decodes whole
	if (edits.length > 1) return null
	if (edit && ts) {
		// a fragmented file's tables are empty (its samples ride in moof boxes): its length stays open
		let start = edit.mediaTime / ts, media = stts ? sttsTotal(stts) / ts : 0, duration = media > start ? media - start : undefined
		let mts = mvhd ? timescale(mvhd) : 0
		if (edit.duration && mts) duration = Math.min(duration ?? Infinity, (edit.duration + (mts < ts ? 1 : 0)) / mts)
		return { start, duration }
	}
	let smpb = ilst && parseSmpb(ilst)
	if (smpb && rate) return { start: smpb.priming / rate, duration: smpb.total ? smpb.total / rate : undefined }
	return null
}

const SBR_DELAY = 962

// the edits that map media (media_time −1 is an empty edit: a pause, not a trim)
function mediaEdits(data) {
	let edits = []
	if (!data) return edits
	let v = data[0], n = r32(data, 4), p = 8
	for (let i = 0; i < n; i++, p += v === 1 ? 20 : 12) {
		let duration = v === 1 ? r32(data, p) * 2 ** 32 + r32(data, p + 4) : r32(data, p)
		let hi = r32(data, v === 1 ? p + 8 : p + 4), mediaTime = v === 1 ? (hi | 0) * 2 ** 32 + r32(data, p + 12) : hi | 0
		if (mediaTime >= 0) edits.push({ duration, mediaTime })
	}
	return edits
}

const timescale = d => r32(d, d[0] === 1 ? 20 : 12) // mvhd / mdhd: version(1) flags(3) created modified timescale

function sttsTotal(d) {
	let n = r32(d, 4), s = 0
	for (let i = 0; i < n; i++) s += r32(d, 8 + i * 8) * r32(d, 12 + i * 8)
	return s
}

// AAC channel configurations 3–6 put the centre first: C L R [Cs | Ls Rs [LFE]] (ISO/IEC 14496-3 Table 1.19).
// Output channel j takes decoded channel AAC_ORDER[config][j]: SMPTE/WAV order (L R C LFE Ls Rs), as the family's
// other decoders and `audio`'s loudness weights read them (ITU-R BS.1770)
const AAC_ORDER = { 3: [1, 2, 0], 4: [1, 2, 0, 3], 5: [1, 2, 0, 3, 4], 6: [1, 2, 0, 5, 3, 4] }
// 7 (8 channels) is not mapped: its second pair is outside front by that table, the sides to most 7.1 encoders

// the AudioSpecificConfig's own sample rate (the core's, when SBR doubles the output)
const ASC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
function ascRate(asc) {
	let i = ((asc[0] & 7) << 1) | (asc[1] >> 7)
	if ((asc[0] >> 3) === 31) i = (asc[1] >> 1) & 15 // escaped object type: the index sits 6 bits later
	return i === 15 ? ((asc[1] & 0x7F) << 17 | asc[2] << 9 | asc[3] << 1 | asc[4] >> 7) : ASC_RATES[i] || 0
}

// iTunes gapless tag (freeform '----' atom named iTunSMPB): hex fields, the 2nd priming, 3rd padding, 4th length
function parseSmpb(ilst) {
	for (let off = 0; off + 8 <= ilst.length;) {
		let size = r32(ilst, off)
		if (size < 8) break
		if (ilst[off + 4] === 0x2D && ilst[off + 5] === 0x2D && ilst[off + 6] === 0x2D && ilst[off + 7] === 0x2D) {
			let name = '', value = null
			for (let p = off + 8; p + 8 <= off + size;) {
				let sz = r32(ilst, p), ty = String.fromCharCode(ilst[p + 4], ilst[p + 5], ilst[p + 6], ilst[p + 7])
				if (sz < 8) break
				if (ty === 'name') name = String.fromCharCode(...ilst.subarray(p + 12, p + sz))
				else if (ty === 'data') value = String.fromCharCode(...ilst.subarray(p + 16, p + sz))
				p += sz
			}
			if (name === 'iTunSMPB' && value) {
				let f = value.trim().split(/\s+/).map(h => parseInt(h, 16))
				if (f.length >= 4 && f.every(Number.isFinite)) return { priming: f[1], padding: f[2], total: f[3] }
			}
		}
		off += size
	}
	return null
}

function parseEsds(data) {
	let off = 4
	while (off < data.length - 2) {
		let tag = data[off++], len = 0, b
		do { b = data[off++]; len = (len << 7) | (b & 0x7f) } while (b & 0x80 && off < data.length)
		if (tag === 0x03) off += 3
		else if (tag === 0x04) off += 13
		else if (tag === 0x05) return data.subarray(off, off + len)
		else off += len
	}
	return null
}

function parseStsz(data) {
	let sz = r32(data, 4), n = r32(data, 8)
	if (sz) return Array(n).fill(sz)
	let sizes = new Array(n)
	for (let i = 0; i < n; i++) sizes[i] = r32(data, 12 + i * 4)
	return sizes
}

function parseStco(data) {
	let n = r32(data, 4), o = new Array(n)
	for (let i = 0; i < n; i++) o[i] = r32(data, 8 + i * 4)
	return o
}

function parseCo64(data) {
	let n = r32(data, 4), o = new Array(n)
	for (let i = 0; i < n; i++) o[i] = r32(data, 8 + i * 8 + 4)
	return o
}

function parseStsc(data) {
	let n = r32(data, 4), e = new Array(n)
	for (let i = 0; i < n; i++) e[i] = { first: r32(data, 8 + i * 12), spc: r32(data, 12 + i * 12) }
	return e
}

function spcAt(ci, stsc) {
	if (!stsc?.length) return 1
	let spc = 1, cn = ci + 1
	for (let j = stsc.length - 1; j >= 0; j--)
		if (cn >= stsc[j].first) { spc = stsc[j].spc; break }
	return spc
}

function advanceM4A(st) {
	st.nextOff += st.sizes[st.idx]
	st.idx++
	st.sInC++
	if (st.sInC >= st.spc && st.ci + 1 < st.stco.length) {
		st.ci++
		st.sInC = 0
		st.spc = spcAt(st.ci, st.stsc)
		st.nextOff = st.stco[st.ci]
	}
}

function r32(buf, off) {
	return (buf[off] << 24 | buf[off + 1] << 16 | buf[off + 2] << 8 | buf[off + 3]) >>> 0
}

/**
 * FLAC decoder backed by libFLAC WASM
 * @module @audio/decode-flac
 */
// build.sh maps the package to its non-worker default export.
import FLACDecoder from '@wasm-audio-decoders/flac'
import CodecParser, { data, totalSamples, codecFrames, isLastPage } from 'codec-parser'
import { oggPages } from '../../_build/ogg.js'

const EMPTY = Object.freeze({ channelData: Object.freeze([]), sampleRate: 0 })

// The upstream glue scales a code by 1/(2^(bits-1) − 1). Back to the code, then 2^-(bits-1), as ffmpeg,
// libsndfile and the family's other decoders and encoders: -32768 reads -1 (was -1.00003), and a
// lossless round trip through any of the family's encoders is the identity.
function rescale(d) {
	let bits = d?.bitDepth
	if (!bits || bits >= 32 || !d.channelData) return d
	let full = 2 ** (bits - 1), up = full - 1
	for (let ch of d.channelData) for (let i = 0; i < ch.length; i++) ch[i] = Math.round(ch[i] * up) / full
	return d
}

export default async function decode(src) {
	let buf = src instanceof Uint8Array ? src : new Uint8Array(src)
	let dec = await decoder()
	try {
		let a = dec.decode(buf)
		let b = dec.flush()
		return hasAudio(b) ? merge(a, b) : a
	} finally { dec.free() }
}

export async function decoder() {
	let upstream = new FLACDecoder()
	await upstream.ready
	// Upstream has no public synchronous API.
	let codec = upstream._decoder, wasm = codec?._common?.wasm
	let outputs = [codec?._channels, codec?._sampleRate, codec?._bitsPerSample,
		codec?._samplesDecoded, codec?._outputBufferPtr, codec?._outputBufferLen,
		codec?._errorStringPtr, codec?._stateStringPtr]
	if (typeof codec?.decodeFrames !== 'function' || typeof wasm?.create_decoder !== 'function' ||
		typeof wasm.destroy_decoder !== 'function' || outputs.some(output => !output?.buf || output.ptr == null)) {
		upstream.free()
		throw Error('Unsupported @wasm-audio-decoders/flac internals')
	}
	let parser = null, prefix = null, lookahead = null, ogg = false, pages = oggPages(), total = 0, fresh = true
	let pendingRaw = false, duplicateFrames = 0, ended = false, freed = false

	let resetStream = () => {
		wasm.destroy_decoder(codec._decoder)
		codec._inputBytes = codec._outputSamples = codec._frameNumber = 0
		for (let output of outputs) output.buf.fill(0)
		codec._decoder = wasm.create_decoder(...outputs.map(output => output.ptr))
		if (!codec._decoder) throw Error('Could not reset FLAC decoder')
		parser = null; prefix = null; lookahead = null; ogg = false; pages = oggPages(); total = 0; fresh = true
		pendingRaw = false; duplicateFrames = 0
	}

	let decodeItems = (items) => {
		if (duplicateFrames && !ogg) {
			let skip = Math.min(duplicateFrames, items.length)
			items = items.slice(skip); duplicateFrames -= skip
		}
		if (!items.length) return null
		if (!ogg) return rescale(codec.decodeFrames(items.map(f => f[data] || f)))

		let frames = items.flatMap(p => p[codecFrames].map(f => f[data]))
		let decoded = rescale(codec.decodeFrames(frames))
		total += decoded.samplesDecoded
		let page = items[items.length - 1]
		if (page?.[isLastPage]) {
			let trim = total - page[totalSamples]
			if (trim > 0) {
				let keep = Math.max(0, decoded.samplesDecoded - trim)
				for (let i = 0; i < decoded.channelData.length; i++)
					decoded.channelData[i] = decoded.channelData[i].subarray(0, keep)
				total -= decoded.samplesDecoded - keep
				decoded.samplesDecoded = keep
			}
		}
		return decoded
	}

	upstream.decode = (chunk) => {
		if (freed) throw Error('Decoder already freed')
		if (ended) throw Error('Decoder already flushed')
		if (!chunk) return EMPTY
		let buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
		if (!buf.length) return EMPTY

		// A zero-total raw stream has no end marker. If more data follows, its
		// first four bytes distinguish another file from a frame continuation.
		if (pendingRaw) {
			if (lookahead) buf = concatBytes(lookahead, buf)
			if (buf.length < 4) { lookahead = buf.slice(); return EMPTY }
			lookahead = null
			if (isStreamStart(buf)) resetStream()
			else pendingRaw = false
		}

		let wasFresh = fresh
		fresh = false

		// Need four bytes before choosing raw FLAC vs Ogg FLAC.
		if (!parser) {
			if (prefix) buf = concatBytes(prefix, buf)
			if (buf.length < 4) { prefix = buf.slice(); return EMPTY }
			prefix = null
			ogg = buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53
			parser = createParser(ogg)
		}

		if (wasFresh) {
			if (ogg && isCompleteOggStream(buf)) {
				let r = decodeItems([...parser.parseAll(buf)])
				resetStream()
				return hasAudio(r) ? r : EMPTY
			}
			if (!ogg) {
				let initial = parseInitialFlac(buf)
				if (initial) {
					let primed = 0
					if (!initial.total) for (let frame of parser.parseChunk(buf)) if (frame) primed++
					let r = decodeItems(initial.frames)
					if (initial.total) resetStream()
					else {
						duplicateFrames = Math.max(0, initial.frames.length - primed)
						pendingRaw = true
					}
					return hasAudio(r) ? r : EMPTY
				}
			}
		}

		let r = decodeItems([...parser.parseChunk(ogg ? pages.push(buf) : buf)])
		return hasAudio(r) ? r : EMPTY
	}

	// Complete files do not need flush; chunked flush is terminal.
	upstream.flush = () => {
		if (freed || ended) return EMPTY
		ended = true
		if (!parser) { prefix = lookahead = null; return EMPTY }
		try {
			let items = lookahead ? [...parser.parseChunk(lookahead), ...parser.flush()] : [...parser.flush()]
			lookahead = null
			let r = decodeItems(items)
			return hasAudio(r) ? r : EMPTY
		} finally { parser = null; prefix = lookahead = null }
	}

	let free = upstream.free.bind(upstream)
	upstream.free = () => {
		if (freed) return
		freed = true; parser = null; prefix = lookahead = null
		free()
	}
	return upstream
}

function createParser(ogg) {
	if (!ogg) return rawParser()
	return new CodecParser('audio/ogg', {
		onCodec: codec => { if (codec !== 'flac') throw Error('@audio/decode-flac does not support this codec ' + codec) },
		enableFrameCRC32: false
	})
}

/**
 * Native FLAC frames (RFC 9639 §9), split here rather than by codec-parser: at the end of its data
 * that parser takes the rest as one frame, and since a CRC-16 that starts from 0 also checks out
 * over valid frames laid end to end, trailing tiny frames (digital silence) merged and all but the
 * first were lost. A frame ends at the nearest CRC-8-verified header before which its bytes pass
 * CRC-16. Same interface as the codec-parser calls here: parseChunk / parseAll / flush → frames.
 */
function rawParser() {
	let buf = new Uint8Array(0), meta = true, start = -1, scan = 0, crc = 0
	function* frames(end) {
		if (meta) {
			if (buf.length < 4) return
			let o = 0
			if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) {
				o = 4
				for (;;) {  // metadata blocks up to the one flagged last
					if (o + 4 > buf.length) return
					let last = buf[o] & 0x80, len = buf[o + 1] << 16 | buf[o + 2] << 8 | buf[o + 3]
					o += 4 + len
					if (o > buf.length) return
					if (last) break
				}
			}
			meta = false; buf = buf.subarray(o)
		}
		if (start < 0) {  // sync to the first header
			let p = 0
			while (p + 1 < buf.length && headerLength(buf, p) < 0) p++
			if (headerLength(buf, p) < 0) { buf = buf.subarray(p); return }
			start = p; scan = p; crc = 0
		}
		for (;;) {
			let next = -1
			for (; scan < buf.length; scan++) {
				if (scan > start + 3 && crc === 0 && buf[scan] === 0xff && (buf[scan + 1] & 0xfe) === 0xf8 && headerLength(buf, scan) > 0) { next = scan; break }
				crc = CRC16[(crc >> 8) ^ buf[scan]] ^ (crc << 8) & 0xffff
			}
			if (next < 0) {
				if (end && start < buf.length && crc === 0) { yield buf.subarray(start); start = scan = buf.length }
				break
			}
			yield buf.subarray(start, next)
			start = next; crc = 0; scan = next
		}
		buf = buf.subarray(start); scan -= start; start = 0
	}
	return {
		parseChunk(chunk) { buf = buf.length ? concatBytes(buf, chunk) : chunk; return [...frames(false)] },
		parseAll(all) { buf = all; return [...frames(true)] },
		flush() { return [...frames(true)] },
	}
}

// CRC-16, polynomial 0x8005, initial 0 (RFC 9639 §9.3)
const CRC16 = Uint16Array.from({ length: 256 }, (_, i) => {
	let c = i << 8
	for (let k = 0; k < 8; k++) c = c & 0x8000 ? (c << 1) ^ 0x8005 : c << 1
	return c & 0xffff
})

/** A frame header at p verified by its CRC-8 (RFC 9639 §9.1): its length in bytes, or -1. */
function headerLength(b, p) {
	if (p + 5 > b.length || b[p] !== 0xff || (b[p + 1] & 0xfe) !== 0xf8) return -1
	let bs = b[p + 2] >> 4, sr = b[p + 2] & 15
	if (!bs || sr === 15 || (b[p + 3] >> 4) > 10 || (b[p + 3] & 1)) return -1
	let q = p + 4, c = b[q], n = c < 0x80 ? 0 : c < 0xe0 ? 1 : c < 0xf0 ? 2 : c < 0xf8 ? 3 : c < 0xfc ? 4 : c < 0xfe ? 5 : 6
	q += 1 + n + (bs === 6 ? 1 : bs === 7 ? 2 : 0) + (sr === 12 ? 1 : sr === 13 || sr === 14 ? 2 : 0)
	if (q >= b.length) return -1
	let crc = 0
	for (let i = p; i < q; i++) { crc ^= b[i]; for (let k = 0; k < 8; k++) crc = crc & 0x80 ? ((crc << 1) ^ 7) & 0xff : (crc << 1) & 0xff }
	return crc === b[q] ? q - p + 1 : -1
}

/** Samples in a frame, from its header's block size (RFC 9639 §9.1.1). */
function frameSamples(b) {
	let bs = b[2] >> 4, c = b[4], n = c < 0x80 ? 0 : c < 0xe0 ? 1 : c < 0xf0 ? 2 : c < 0xf8 ? 3 : c < 0xfc ? 4 : c < 0xfe ? 5 : 6
	let q = 5 + n
	return bs === 1 ? 192 : bs <= 5 ? 576 << (bs - 2) : bs === 6 ? b[q] + 1 : bs === 7 ? (b[q] << 8 | b[q + 1]) + 1 : 256 << (bs - 8)
}

function parseInitialFlac(buf) {
	let info = flacInfo(buf)
	if (!info) return null
	try {
		let frames = [...createParser(false).parseAll(buf)]
		if (!frames.length) return null
		let parsed = frames.reduce((total, frame) => total + frameSamples(frame), 0)
		return !info.total || parsed === info.total ? { frames, total: info.total } : null
	} catch { return null }
}

function flacInfo(buf) {
	if (buf.length < 42 || buf[0] !== 0x66 || buf[1] !== 0x4c || buf[2] !== 0x61 ||
		buf[3] !== 0x43 || (buf[4] & 0x7f) !== 0 || (buf[5] << 16 | buf[6] << 8 | buf[7]) < 34)
		return null
	let total = (buf[21] & 15) * 0x100000000 + buf[22] * 0x1000000 +
		buf[23] * 0x10000 + buf[24] * 0x100 + buf[25]
	for (let offset = 4; offset + 4 <= buf.length;) {
		let last = buf[offset] & 0x80
		let length = buf[offset + 1] * 0x10000 + buf[offset + 2] * 0x100 + buf[offset + 3]
		offset += 4 + length
		if (offset > buf.length) return null
		if (last) return { total }
	}
	return null
}

function isStreamStart(buf) {
	return (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) ||
		(buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53)
}

function isCompleteOggStream(buf) {
	let offset = 0, first = true
	while (offset < buf.length) {
		if (offset + 27 > buf.length || buf[offset] !== 0x4f || buf[offset + 1] !== 0x67 ||
			buf[offset + 2] !== 0x67 || buf[offset + 3] !== 0x53 || buf[offset + 4] !== 0)
			return false
		let flags = buf[offset + 5], segments = buf[offset + 26]
		if (first && !(flags & 2)) return false
		let body = offset + 27 + segments
		if (body > buf.length) return false
		let end = body
		for (let i = offset + 27; i < body; i++) end += buf[i]
		if (end > buf.length) return false
		if (flags & 4) return end === buf.length
		offset = end; first = false
	}
	return false
}

function hasAudio(result) {
	return !!result?.channelData?.[0]?.length
}

function concatBytes(a, b) {
	let r = new Uint8Array(a.length + b.length)
	r.set(a); r.set(b, a.length)
	return r
}

function merge(a, b) {
	if (!hasAudio(b)) return a
	if (!hasAudio(a)) return b
	return {
		channelData: a.channelData.map((ch, i) => {
			let bc = b.channelData[i] || b.channelData[0]
			let m = new Float32Array(ch.length + bc.length)
			m.set(ch); m.set(bc, ch.length)
			return m
		}),
		sampleRate: a.sampleRate
	}
}

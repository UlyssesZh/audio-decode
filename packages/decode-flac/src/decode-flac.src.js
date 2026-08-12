/**
 * FLAC decoder backed by libFLAC WASM
 * @module @audio/decode-flac
 */
// build.sh maps the package to its non-worker default export.
import FLACDecoder from '@wasm-audio-decoders/flac'
import CodecParser, { data, totalSamples, samples, codecFrames, isLastPage } from 'codec-parser'

const EMPTY = Object.freeze({ channelData: Object.freeze([]), sampleRate: 0 })

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
	let parser = null, prefix = null, lookahead = null, ogg = false, total = 0, fresh = true
	let pendingRaw = false, duplicateFrames = 0, ended = false, freed = false

	let resetStream = () => {
		wasm.destroy_decoder(codec._decoder)
		codec._inputBytes = codec._outputSamples = codec._frameNumber = 0
		for (let output of outputs) output.buf.fill(0)
		codec._decoder = wasm.create_decoder(...outputs.map(output => output.ptr))
		if (!codec._decoder) throw Error('Could not reset FLAC decoder')
		parser = null; prefix = null; lookahead = null; ogg = false; total = 0; fresh = true
		pendingRaw = false; duplicateFrames = 0
	}

	let decodeItems = (items) => {
		if (duplicateFrames && !ogg) {
			let skip = Math.min(duplicateFrames, items.length)
			items = items.slice(skip); duplicateFrames -= skip
		}
		if (!items.length) return null
		if (!ogg) return codec.decodeFrames(items.map(f => f[data] || f))

		let frames = items.flatMap(p => p[codecFrames].map(f => f[data]))
		let decoded = codec.decodeFrames(frames)
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

		let r = decodeItems([...parser.parseChunk(buf)])
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
	return new CodecParser(ogg ? 'audio/ogg' : 'audio/flac', {
		onCodec: codec => { if (codec !== 'flac') throw Error('@audio/decode-flac does not support this codec ' + codec) },
		enableFrameCRC32: false
	})
}

function parseInitialFlac(buf) {
	let info = flacInfo(buf)
	if (!info) return null
	try {
		let frames = [...createParser(false).parseAll(buf)]
		if (!frames.length) return null
		let parsed = frames.reduce((total, frame) => total + (frame[samples] || 0), 0)
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

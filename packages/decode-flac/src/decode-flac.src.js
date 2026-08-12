/**
 * FLAC decoder backed by libFLAC WASM
 * @module @audio/decode-flac
 */
import { FLACDecoder } from '@wasm-audio-decoders/flac'
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
	let parser = null, prefix = null, ogg = false, total = 0, fresh = true, ended = false, freed = false

	let resetStream = () => {
		wasm.destroy_decoder(codec._decoder)
		codec._inputBytes = codec._outputSamples = codec._frameNumber = 0
		for (let output of outputs) output.buf.fill(0)
		codec._decoder = wasm.create_decoder(...outputs.map(output => output.ptr))
		if (!codec._decoder) throw Error('Could not reset FLAC decoder')
		parser = null; prefix = null; ogg = false; total = 0; fresh = true
	}

	let decodeItems = (items) => {
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
			let items = ogg && isCompleteOggStream(buf) ? [...parser.parseAll(buf)] :
				!ogg ? completeFlacFrames(buf) : null
			if (items) {
				let r = decodeItems(items)
				resetStream()
				return hasAudio(r) ? r : EMPTY
			}
		}

		let r = decodeItems([...parser.parseChunk(buf)])
		return hasAudio(r) ? r : EMPTY
	}

	// Complete files do not need flush; chunked flush is terminal.
	upstream.flush = () => {
		if (freed || ended) return EMPTY
		ended = true
		if (!parser) { prefix = null; return EMPTY }
		try {
			let r = decodeItems([...parser.flush()])
			return hasAudio(r) ? r : EMPTY
		} finally { parser = null; prefix = null }
	}

	let free = upstream.free.bind(upstream)
	upstream.free = () => {
		if (freed) return
		freed = true; parser = null; prefix = null
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

function completeFlacFrames(buf) {
	let expected = flacTotalSamples(buf)
	if (!expected) return null
	try {
		let frames = [...createParser(false).parseAll(buf)]
		let parsed = frames.reduce((total, frame) => total + (frame[samples] || 0), 0)
		return parsed === expected ? frames : null
	} catch { return null }
}

function flacTotalSamples(buf) {
	if (buf.length < 42 || buf[0] !== 0x66 || buf[1] !== 0x4c || buf[2] !== 0x61 ||
		buf[3] !== 0x43 || (buf[4] & 0x7f) !== 0 || (buf[5] << 16 | buf[6] << 8 | buf[7]) < 34)
		return 0
	return (buf[21] & 15) * 0x100000000 + buf[22] * 0x1000000 +
		buf[23] * 0x10000 + buf[24] * 0x100 + buf[25]
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

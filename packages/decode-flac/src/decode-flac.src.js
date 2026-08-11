/**
 * FLAC decoder backed by libFLAC WASM
 * @module @audio/decode-flac
 */
import { FLACDecoder } from '@wasm-audio-decoders/flac'
import CodecParser, { data, totalSamples, codecFrames, isLastPage } from 'codec-parser'

const EMPTY = Object.freeze({ channelData: Object.freeze([]), sampleRate: 0 })

export default async function decode(src) {
	let buf = src instanceof Uint8Array ? src : new Uint8Array(src)
	let dec = await decoder()
	try {
		let a = dec.decode(buf)
		let b = dec.flush()
		return b?.channelData?.length ? merge(a, b) : a
	} finally { dec.free() }
}

export async function decoder() {
	let upstream = new FLACDecoder()
	await upstream.ready
	// Upstream has no public synchronous API.
	let codec = upstream._decoder
	if (typeof codec?.decodeFrames !== 'function') {
		upstream.free()
		throw Error('Unsupported @wasm-audio-decoders/flac internals')
	}
	let parser = null, prefix = null, ogg = false, total = 0, ended = false, freed = false

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

		// Need four bytes before choosing raw FLAC vs Ogg FLAC.
		if (!parser) {
			if (prefix) buf = concatBytes(prefix, buf)
			if (buf.length < 4) { prefix = buf.slice(); return EMPTY }
			prefix = null
			ogg = buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53
			parser = new CodecParser(ogg ? 'audio/ogg' : 'audio/flac', {
				onCodec: c => { if (c !== 'flac') throw Error('@audio/decode-flac does not support this codec ' + c) },
				enableFrameCRC32: false
			})
		}

		let r = decodeItems([...parser.parseChunk(buf)])
		return r?.channelData?.length ? r : EMPTY
	}

	// Synchronous flush is terminal; create another decoder for another stream.
	upstream.flush = () => {
		if (freed || ended) return EMPTY
		ended = true
		if (!parser) { prefix = null; return EMPTY }
		try {
			let r = decodeItems([...parser.flush()])
			return r?.channelData?.length ? r : EMPTY
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

function concatBytes(a, b) {
	let r = new Uint8Array(a.length + b.length)
	r.set(a); r.set(b, a.length)
	return r
}

function merge(a, b) {
	if (!b?.channelData?.length) return a
	if (!a?.channelData?.length) return b
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

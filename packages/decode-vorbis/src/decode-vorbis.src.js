/**
 * Ogg Vorbis decoder backed by libvorbis WASM
 * @module @audio/decode-vorbis
 */
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis'
import CodecParser, { data, totalSamples, codecFrames, header, vorbisSetup, isLastPage } from 'codec-parser'

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
	let upstream = new OggVorbisDecoder()
	await upstream.ready
	// Upstream has no public synchronous API.
	let codec = upstream._decoder, wasm = codec?._common?.wasm
	if (typeof codec?.sendSetupHeader !== 'function' || typeof codec.initDsp !== 'function' ||
		typeof codec.decodePackets !== 'function' || typeof wasm?.malloc !== 'function' ||
		typeof wasm.free !== 'function' || !(wasm.HEAP instanceof ArrayBuffer)) {
		upstream.free()
		throw Error('Unsupported @wasm-audio-decoders/ogg-vorbis internals')
	}
	// The upstream reset reinstantiates WASM asynchronously. Keep a pristine
	// image through the allocator's initial heap boundary so the same instance
	// can be restored synchronously without retaining a second WASM heap.
	let heapEnd = wasm.malloc(1)
	if (!heapEnd) { upstream.free(); throw Error('Could not initialize Ogg Vorbis decoder') }
	wasm.free(heapEnd)
	heapEnd = Math.min(wasm.HEAP.byteLength, Math.ceil((heapEnd + 65536) / 65536) * 65536)
	let initialMemory = new Uint8Array(wasm.HEAP, 0, heapEnd).slice()

	let createParser = () => new CodecParser('audio/ogg', {
		onCodec: c => { if (c !== 'vorbis') throw Error('@audio/decode-vorbis does not support this codec ' + c) },
		enableFrameCRC32: false
	})
	let parser = createParser(), setup = true, total = 0, fresh = true
	let resetPending = false, ended = false, freed = false

	let resetCodec = () => {
		if (wasm.HEAP.byteLength < initialMemory.length)
			throw Error('Could not reset Ogg Vorbis decoder')
		new Uint8Array(wasm.HEAP, 0, initialMemory.length).set(initialMemory)
		codec._firstPage = true
		codec._frameNumber = codec._inputBytes = codec._outputSamples = 0
	}

	let startStream = () => {
		resetCodec()
		parser = createParser(); setup = true; total = 0; fresh = true; resetPending = false
	}

	let decodePages = (pages) => {
		if (!pages.length) return null
		let packets = []

		for (let page of pages) {
			if (setup) {
				if (page[data][0] === 1) codec.sendSetupHeader(page[data])
				if (page[codecFrames].length) {
					let setupHeader = page[codecFrames][0][header][vorbisSetup]
					codec.sendSetupHeader(setupHeader)
					codec.initDsp()
					setup = false
				}
			}
			packets.push(...page[codecFrames].map(f => f[data]))
		}

		// Calling the low-level decoder without packets exposes uninitialized
		// channel and sample-rate output pointers.
		if (!packets.length) return null
		let decoded = codec.decodePackets(packets)
		total += decoded.samplesDecoded
		let page = pages[pages.length - 1]
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
		if (resetPending) startStream()

		if (fresh && isCompleteOggStream(buf)) {
			let r = decodePages([...parser.parseAll(buf)])
			// Keep this initialized codec alive until another stream arrives. A
			// newly created upstream codec cannot be safely freed before setup.
			parser = null; resetPending = true
			return hasAudio(r) ? r : EMPTY
		}

		fresh = false
		let r = decodePages([...parser.parseChunk(buf)])
		return hasAudio(r) ? r : EMPTY
	}

	// Complete files do not need flush; chunked flush is terminal.
	upstream.flush = () => {
		if (freed || ended) return EMPTY
		ended = true
		if (resetPending) { parser = null; return EMPTY }
		try {
			let r = decodePages([...parser.flush()])
			return hasAudio(r) ? r : EMPTY
		} finally { parser = null }
	}

	let free = upstream.free.bind(upstream)
	upstream.free = () => {
		if (freed) return
		freed = true; parser = null
		free(); initialMemory = null
	}
	return upstream
}

function hasAudio(result) {
	return !!result?.channelData?.[0]?.length
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

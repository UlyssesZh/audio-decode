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
		return b?.channelData?.length ? merge(a, b) : a
	} finally { dec.free() }
}

export async function decoder() {
	let upstream = new OggVorbisDecoder()
	await upstream.ready
	// Upstream has no public synchronous API.
	let codec = upstream._decoder
	if (typeof codec?.sendSetupHeader !== 'function' || typeof codec.initDsp !== 'function' || typeof codec.decodePackets !== 'function') {
		upstream.free()
		throw Error('Unsupported @wasm-audio-decoders/ogg-vorbis internals')
	}
	let parser = new CodecParser('audio/ogg', {
		onCodec: c => { if (c !== 'vorbis') throw Error('@audio/decode-vorbis does not support this codec ' + c) },
		enableFrameCRC32: false
	})
	let setup = true, total = 0, ended = false, freed = false

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
		let r = decodePages([...parser.parseChunk(buf)])
		return r?.channelData?.length ? r : EMPTY
	}

	// Synchronous flush is terminal; create another decoder for another stream.
	upstream.flush = () => {
		if (freed || ended) return EMPTY
		ended = true
		try {
			let r = decodePages([...parser.flush()])
			return r?.channelData?.length ? r : EMPTY
		} finally { parser = null }
	}

	let free = upstream.free.bind(upstream)
	upstream.free = () => {
		if (freed) return
		freed = true; parser = null
		free()
	}
	return upstream
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

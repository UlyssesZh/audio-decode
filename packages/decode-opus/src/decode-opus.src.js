/**
 * Ogg Opus decoder backed by local libopus WASM
 * @module @audio/decode-opus
 */
import CodecParser, {
	absoluteGranulePosition,
	channelMappingTable,
	channels,
	codecFrames,
	coupledStreamCount,
	data,
	header,
	isLastPage,
	outputGain,
	preSkip,
	streamCount,
	totalSamples
} from 'codec-parser'
import { createOpusDecoder } from '../core.js'

const EMPTY = Object.freeze({ channelData: Object.freeze([]), sampleRate: 0 })

export default async function decode(src) {
	let buf = src instanceof Uint8Array ? src : new Uint8Array(src)
	let dec = await decoder()
	try {
		let head = dec.decode(buf)
		let tail = dec.flush()
		return merge(head, tail)
	} finally { dec.free() }
}

export async function decoder() {
	let core = await createOpusDecoder()
	let parser = new CodecParser('application/ogg', {
		onCodec: codec => { if (codec !== 'opus') throw Error('@audio/decode-opus does not support this codec ' + codec) },
		enableFrameCRC32: false
	})
	let configured = false, total = 0, ended = false, freed = false

	let decodePages = pages => {
		let results = []
		for (let page of pages) {
			let frames = page[codecFrames]
			if (frames.length) {
				if (!configured) {
					let info = frames[0][header]
					core.configure({
						sampleRate: 48000,
						channels: info[channels],
						streamCount: info[streamCount],
						coupledStreamCount: info[coupledStreamCount],
						channelMappingTable: info[channelMappingTable],
						preSkip: info[preSkip],
						outputGain: info[outputGain]
					})
					configured = true
					total = 0
				}

				let decoded = core.decodeFrames(frames.map(frame => frame[data]))
				total += decoded.samplesDecoded
				if (decoded.channelData.length) results.push(decoded)
			}

			if (page[isLastPage]) {
				if (page[absoluteGranulePosition] !== undefined && results.length) {
					let trim = total - page[totalSamples]
					if (trim > 0) {
						let decoded = results[results.length - 1]
						let keep = Math.max(0, decoded.samplesDecoded - trim)
						decoded.channelData = decoded.channelData.map(channel => channel.subarray(0, keep))
						decoded.samplesDecoded = keep
					}
				}
				core.unconfigure()
				configured = false
				total = 0
			}
		}
		return mergeAll(results)
	}

	return {
		decode(chunk) {
			if (freed) throw Error('Decoder already freed')
			if (ended) throw Error('Decoder already flushed')
			if (!chunk) return EMPTY
			let buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
			if (!buf.length) return EMPTY
			return decodePages([...parser.parseChunk(buf)])
		},
		flush() {
			if (freed || ended) return EMPTY
			ended = true
			try { return decodePages([...parser.flush()]) }
			finally {
				parser = null
				core.unconfigure()
				configured = false
			}
		},
		free() {
			if (freed) return
			freed = true
			parser = null
			core.free()
		}
	}
}

function mergeAll(results) {
	if (!results.length) return EMPTY
	if (results.length === 1) return results[0]
	let channels = Math.max(...results.map(result => result.channelData.length))
	return {
		errors: results.flatMap(result => result.errors),
		channelData: Array.from({ length: channels }, (_, channel) => {
			let length = results.reduce((sum, result) => sum + result.channelData[channel % result.channelData.length].length, 0)
			let output = new Float32Array(length), offset = 0
			for (let result of results) {
				let input = result.channelData[channel % result.channelData.length]
				output.set(input, offset)
				offset += input.length
			}
			return output
		}),
		samplesDecoded: results.reduce((sum, result) => sum + result.samplesDecoded, 0),
		sampleRate: results[0].sampleRate,
		bitDepth: 32
	}
}

function merge(a, b) {
	if (!b?.channelData?.length) return a
	if (!a?.channelData?.length) return b
	return mergeAll([a, b])
}

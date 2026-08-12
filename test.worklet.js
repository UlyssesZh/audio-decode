// Regression for #50: imports and decoding run inside AudioWorkletGlobalScope.
import { decoder as flacDecoder } from './packages/decode-flac/decode-flac.js'
import { decoder as vorbisDecoder } from './packages/decode-vorbis/decode-vorbis.js'
import { decoder as mp3Decoder } from './packages/decode-mp3/decode-mp3.js'
import wavDecode from './packages/decode-wav/decode-wav.js'

const summarize = value => {
	if (typeof value?.then === 'function') return { sync: false }
	let channelData = value.channelData || []
	return {
		sync: true,
		channels: channelData.length,
		samples: channelData[0]?.length || 0,
		sampleRate: value.sampleRate,
		finite: channelData.every(channel => channel.every(Number.isFinite)),
		active: channelData.some(channel => channel.some(sample => sample !== 0)),
	}
}

registerProcessor('decode-test', class extends AudioWorkletProcessor {
	constructor({ processorOptions: fixtures }) {
		super()
		this.decodeAll(fixtures)
	}
	async decodeAll(fixtures) {
		let globals = ['Blob', 'TextDecoder', 'atob', 'Worker', 'URL', 'fetch', 'performance', 'setTimeout']
		let report = { globals: Object.fromEntries(globals.map(name => [name, typeof globalThis[name]])) }
		try {
			for (let [name, create, inputs] of [
				['flac', flacDecoder, [fixtures.flacA, fixtures.flacA, fixtures.flacB]],
				['vorbis', vorbisDecoder, [fixtures.vorbisA, fixtures.vorbisA, fixtures.vorbisB]],
				['mp3', mp3Decoder, [fixtures.mp3]],
			]) {
				let decoder = await create()
				let output = [
					decoder.decode(null),
					decoder.decode(new Uint8Array()),
					...inputs.map(bytes => decoder.decode(new Uint8Array(bytes))),
				]
				report[name] = output.map(summarize)
				decoder.free()
			}
			report.wav = summarize(wavDecode(new Uint8Array(fixtures.wav)))
		} catch (error) {
			report.error = String(error?.stack || error)
		}
		this.port.postMessage(report)
	}
	process() { return true }
})

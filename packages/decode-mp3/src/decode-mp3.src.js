/**
 * MP3 decoder — mpg123 compiled to WASM
 * @module @audio/decode-mp3
 */
// build.sh maps the package to its non-worker default export.
import MPEGDecoder from 'mpg123-decoder'

const EMPTY = Object.freeze({ channelData: Object.freeze([]), sampleRate: 0 })

export default async function decode(src) {
	let buf = src instanceof Uint8Array ? src : new Uint8Array(src)
	let dec = await decoder()
	try { return dec.decode(buf) } finally { dec.free() }
}

export async function decoder() {
	let upstream = new MPEGDecoder()
	await upstream.ready
	let decode = upstream.decode.bind(upstream)
	let free = upstream.free.bind(upstream)
	let freed = false

	upstream.decode = chunk => {
		if (freed) throw Error('Decoder already freed')
		if (!chunk) return EMPTY
		let buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
		if (!buf.length) return EMPTY
		return decode(buf)
	}
	upstream.free = () => {
		if (freed) return
		freed = true
		free()
	}
	return upstream
}

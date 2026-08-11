/**
 * QOA (Quite OK Audio) decoder
 * @module @audio/decode-qoa
 */
import decodeQoaData from 'qoa-format/decode.js'

/** Decode a complete QOA file synchronously. */
const decodeQoa = src => decodeQoaData(src instanceof Uint8Array ? src : new Uint8Array(src))

export { decodeQoa as default }

/** Create a synchronous stateless decoder. */
export function decoder() {
	return {
		decode: decodeQoa,
		flush: () => ({ channelData: [], sampleRate: 0 }),
		free: () => {}
	}
}

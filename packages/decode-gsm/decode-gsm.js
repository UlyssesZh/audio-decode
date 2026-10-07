/**
 * GSM 06.10 full-rate decoder: libgsm 1.0.22 (Degener & Bormann, TU Berlin) compiled to WASM.
 * Raw frames, 33 bytes each (SoX's .gsm, RTP payload 3), 160 samples at 8 kHz from each.
 *
 * let { channelData, sampleRate } = await decode(gsmbytes)
 */

import createGSM from './src/gsm.wasm.js'

const FRAME = 33, N = 160
let _modP

async function getMod() {
	if (_modP) return _modP
	let p = _modP = createGSM()
	try { return await p }
	catch (e) { _modP = null; throw e }
}

/**
 * Whole-file decode
 * @param {Uint8Array|ArrayBuffer} src
 * @returns {Promise<{channelData: Float32Array[], sampleRate: number}>}
 */
export default async function decode(src) {
	let dec = await decoder()
	try { return dec.decode(src instanceof Uint8Array ? src : new Uint8Array(src)) }
	finally { dec.free() }
}

/**
 * Streaming decoder: bytes in any split, whole frames decoded as they complete
 * @returns {Promise<{decode(chunk: Uint8Array): {channelData, sampleRate}, flush(), free()}>}
 */
export async function decoder() {
	let m = await getMod(), g = m._gsmw_create(), left = new Uint8Array(0), cap = 0, inP = 0, outP = 0
	if (!g) throw Error('gsm: out of memory')
	let EMPTY = { channelData: [new Float32Array(0)], sampleRate: 8000 }
	return {
		decode(chunk) {
			if (!g) throw Error('Decoder already freed')
			let buf = left.length ? concat(left, chunk) : chunk, n = Math.floor(buf.length / FRAME)
			left = buf.slice(n * FRAME)
			if (!n) return EMPTY
			if (n > cap) {
				if (cap) { m._free(inP); m._free(outP) }
				cap = n; inP = m._malloc(n * FRAME); outP = m._malloc(n * N * 2)
			}
			m.HEAPU8.set(buf.subarray(0, n * FRAME), inP)
			let k = m._gsmw_decode(g, inP, outP, n)
			if (k < n) throw Error(`gsm: frame ${k} is not a GSM 06.10 frame (its first nibble is not 0xD)`)
			let pcm = new Int16Array(m.HEAP16.buffer, outP, n * N), out = new Float32Array(n * N)
			for (let i = 0; i < out.length; i++) out[i] = pcm[i] / 32768
			return { channelData: [out], sampleRate: 8000 }
		},
		/** a trailing partial frame is dropped: GSM has no partial frames */
		flush() { left = new Uint8Array(0); return EMPTY },
		free() {
			if (!g) return
			if (cap) { m._free(inP); m._free(outP) }
			m._gsmw_destroy(g); g = 0
		},
	}
}

function concat(a, b) { let r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r }

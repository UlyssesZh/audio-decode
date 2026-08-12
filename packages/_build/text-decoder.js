/** Scoped UTF-8 fallback for Emscripten bundles without a global TextDecoder. */
export const TextDecoder = globalThis.TextDecoder ?? class {
	decode(u8) {
		let s = '', i = 0
		while (i < u8.length) {
			let b = u8[i++], c = b
			if (b > 0x7f) {
				let n = b > 0xef ? 3 : b > 0xdf ? 2 : 1
				for (c = b & 0x3f >> n; n--;) c = c << 6 | u8[i++] & 0x3f
			}
			if (c > 0xffff) c -= 0x10000, s += String.fromCharCode(0xd800 | c >> 10, 0xdc00 | c & 0x3ff)
			else s += String.fromCharCode(c)
		}
		return s
	}
}

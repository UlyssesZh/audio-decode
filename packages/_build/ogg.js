// Ogg pages framed ahead of codec-parser, which is fed whole pages only: a stream cut inside a page ends at the page
// before it. Fed the start of a page, codec-parser reads its header and waits for the body; its flush then builds the
// page from the bytes it has, a header read past the end (RangeError) or packets cut short, which decode to garbage.
const isPage = (b, o) => b[o] === 0x4f && b[o + 1] === 0x67 && b[o + 2] === 0x67 && b[o + 3] === 0x53

/** Bytes of `buf` that end on a page boundary. Bytes that aren't a page pass through: the parser resyncs past them. */
function whole(buf) {
	let o = 0
	while (o + 27 <= buf.length) {
		if (!isPage(buf, o)) {
			let k = o + 1
			while (k + 4 <= buf.length && !isPage(buf, k)) k++
			if (k + 4 > buf.length) return Math.max(o, buf.length - 3)  // a sync may straddle the end
			o = k; continue
		}
		let body = o + 27 + buf[o + 26], end = body
		if (body > buf.length) break
		for (let i = o + 27; i < body; i++) end += buf[i]
		if (end > buf.length) break
		o = end
	}
	return o
}

/** push(chunk) → the whole pages that have arrived; an unfinished page waits, and at flush it never reaches the parser. */
export function oggPages() {
	let tail = null
	return {
		push(chunk) {
			let buf = tail ? concat(tail, chunk) : chunk, n = whole(buf)
			tail = n < buf.length ? buf.slice(n) : null
			return buf.subarray(0, n)
		}
	}
}

function concat(a, b) {
	let out = new Uint8Array(a.length + b.length)
	out.set(a); out.set(b, a.length)
	return out
}

import decode, { decoder } from './decode-vorbis.js'
import { parseMeta } from './meta.js'
import { readFileSync } from 'fs'
import ogg from 'audio-lena/ogg'

let pass = 0, fail = 0
function ok(cond, msg) {
	if (cond) { pass++; console.log('  ok', msg) }
	else { fail++; console.log('  FAIL', msg) }
}
function near(a, b, tol = 0.02) { return Math.abs(a - b) < tol }
function rms(f32) { let s = 0; for (let i = 0; i < f32.length; i++) s += f32[i] * f32[i]; return Math.sqrt(s / f32.length) }

// whole-file decode
console.log('Vorbis whole-file')
let whole = await decode(ogg)
ok(whole.channelData.length >= 1, 'has channels')
ok(whole.sampleRate === 44100, 'sampleRate 44100')
ok(near(whole.channelData[0].length / whole.sampleRate, 12.27), 'duration ~12.27s')
ok(rms(whole.channelData[0]) > 0.05, 'has audio content')

// one async init, synchronous decode calls
console.log('Vorbis streaming')
{
	let dec = await decoder()
	let empty = dec.decode(null), zero = dec.decode(new Uint8Array())
	ok(!(empty instanceof Promise) && !(zero instanceof Promise) && !empty.channelData.length && !zero.channelData.length, 'null and empty chunks return empty values')
	let buf = new Uint8Array(ogg), results = [], sync = true
	for (let off = 0, size = 1; off < buf.length; off += size, size = Math.min(size * 3, 7919)) {
		let chunk = buf.subarray(off, off + size)
		let r = dec.decode(off ? chunk : chunk.slice().buffer)
		sync &&= !(r instanceof Promise)
		results.push(r)
	}
	ok(sync, 'decode returns value, not promise')
	let tail = dec.flush()
	ok(!(tail instanceof Promise), 'flush returns value, not promise')
	results.push(tail)
	let total = results.reduce((n, r) => n + (r.channelData[0]?.length || 0), 0)
	ok(total === whole.channelData[0].length, 'chunked sync decode matches whole-file length')
	let threw = false
	try { dec.decode(buf) } catch { threw = true }
	ok(threw, 'decode after flush throws')
	dec.free()
	threw = false
	try { dec.decode(buf) } catch { threw = true }
	ok(threw, 'decode after free throws')
}

console.log('Vorbis granule trim clamp')
{
	// Last-page granule claiming fewer samples than already decoded must clamp to
	// empty output, not subarray with a negative end.
	let buf = new Uint8Array(ogg), last = -1
	for (let i = 0; i < buf.length - 3; i++)
		if (buf[i] === 0x4f && buf[i + 1] === 0x67 && buf[i + 2] === 0x67 && buf[i + 3] === 0x53) last = i
	let patched = buf.slice()
	patched[last + 6] = 1
	for (let i = 7; i < 14; i++) patched[last + i] = 0
	let dec = await decoder()
	let head = dec.decode(patched.subarray(0, last))
	let tail = dec.decode(patched.subarray(last))
	let flushed = dec.flush()
	dec.free()
	for (let r of [head, tail, flushed]) {
		ok(!(r.samplesDecoded < 0), 'samplesDecoded never negative: ' + r.samplesDecoded)
		ok(r.channelData.every(ch => ch.length === (r.channelData[0]?.length || 0)), 'channels equal length')
	}
}

// ===== metadata (Vorbis comments) =====
console.log('Vorbis metadata')
{
	let { meta, sampleRate } = parseMeta(readFileSync(new URL('./fixtures/tagged.ogg', import.meta.url)))
	ok(sampleRate === 44100, 'sampleRate from id header')
	ok(meta.title === 'Lena Sine', 'title')
	ok(meta.artist === 'audiojs', 'artist')
	ok(meta.album === 'Fixtures', 'album')
	ok(meta.year === '2026', 'year (from DATE)')
	ok(meta.genre === 'Test', 'genre')
	ok(Array.isArray(meta.pictures), 'pictures array present')
	ok(parseMeta(new Uint8Array([1, 2, 3, 4])) === null, 'non-ogg → null')
}

// METADATA_BLOCK_PICTURE (cover art) — synthetic comment packet
console.log('Vorbis cover art')
{
	// build a FLAC PICTURE block: type=3, mime=image/png, no desc, 2-byte payload
	let mime = 'image/png', be = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]
	let pic = [...be(3), ...be(mime.length), ...[...mime].map(c => c.charCodeAt(0)), ...be(0), ...be(0), ...be(0), ...be(0), ...be(0), ...be(2), 0xAB, 0xCD]
	let b64 = Buffer.from(pic).toString('base64')
	let kv = 'METADATA_BLOCK_PICTURE=' + b64
	let le = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
	// comment block: vendor("") + 1 comment
	let block = [...le(0), ...le(1), ...le(kv.length), ...[...kv].map(c => c.charCodeAt(0))]
	let { parseComment } = await import('./meta.js')
	let { pictures } = parseComment(new Uint8Array(block))
	ok(pictures.length === 1, 'picture extracted')
	ok(pictures[0].mime === 'image/png', 'picture mime')
	ok(pictures[0].data.length === 2 && pictures[0].data[0] === 0xAB, 'picture payload')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

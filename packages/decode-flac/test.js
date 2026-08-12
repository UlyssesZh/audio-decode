import decode, { decoder } from './decode-flac.js'
import { readFileSync } from 'node:fs'
import flac from 'audio-lena/flac'

const oggFlac = readFileSync(new URL('./fixtures/mono.oga', import.meta.url))

let pass = 0, fail = 0
function ok(cond, msg) {
	if (cond) { pass++; console.log('  ok', msg) }
	else { fail++; console.log('  FAIL', msg) }
}
function near(a, b, tol = 0.02) { return Math.abs(a - b) < tol }
function rms(f32) { let s = 0; for (let i = 0; i < f32.length; i++) s += f32[i] * f32[i]; return Math.sqrt(s / f32.length) }

// whole-file decode
console.log('FLAC whole-file')
let whole = await decode(flac)
ok(whole.channelData.length >= 1, 'has channels')
ok(whole.sampleRate === 44100, 'sampleRate 44100')
ok(near(whole.channelData[0].length / whole.sampleRate, 12.27), 'duration ~12.27s')
ok(near(rms(whole.channelData[0]), 0.1298, 0.001), 'rms lossless')

console.log('FLAC reusable whole-file decoder')
{
	let dec = await decoder(), buf = new Uint8Array(flac)
	for (let i = 0; i < 3; i++) {
		let input = i ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
		let result = dec.decode(input)
		ok(!(result instanceof Promise), 'complete-file decode returns a value')
		ok(result.channelData.length === whole.channelData.length && result.sampleRate === whole.sampleRate, 'complete-file decode returns valid format')
		ok(result.channelData[0].length === whole.channelData[0].length, 'complete-file decode returns all samples')
		ok(result.channelData[0].every((value, index) => value === whole.channelData[0][index]), 'reused decoder returns identical PCM')
	}
	let oggResult = dec.decode(oggFlac)
	ok(oggResult.sampleRate === 48000 && oggResult.channelData[0]?.length === 12000, 'reused decoder switches to Ogg FLAC')
	let rawResult = dec.decode(buf)
	ok(rawResult.sampleRate === whole.sampleRate && rawResult.channelData[0]?.length === whole.channelData[0].length, 'reused decoder switches back to raw FLAC')
	ok(!dec.flush().channelData.length, 'flush after a complete file is empty')
	let threw = false
	try { dec.decode(buf) } catch { threw = true }
	ok(threw, 'flush after a complete file is terminal')
	dec.free()

	let unknown = buf.slice()
	unknown[21] &= 0xf0
	unknown.fill(0, 22, 26)
	let stream = await decoder(), head = stream.decode(unknown), tail = stream.flush()
	ok((head.channelData[0]?.length || 0) + (tail.channelData[0]?.length || 0) === whole.channelData[0].length, 'unknown sample total falls back to streaming')
	stream.free()
}

// one async init, synchronous decode calls
console.log('FLAC streaming')
{
	let dec = await decoder()
	let empty = dec.decode(null), zero = dec.decode(new Uint8Array())
	ok(!(empty instanceof Promise) && !(zero instanceof Promise) && !empty.channelData.length && !zero.channelData.length, 'null and empty chunks return empty values')
	let buf = new Uint8Array(flac), results = []
	let first = dec.decode(buf.slice(0, 1).buffer)
	ok(!(first instanceof Promise), 'decode returns value, not promise')
	results.push(first)
	for (let off = 1; off < buf.length; off += 99991)
		results.push(dec.decode(buf.subarray(off, off + 99991)))
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

console.log('Ogg FLAC streaming')
{
	let source = oggFlac
	let whole = await decode(source)
	ok(whole.sampleRate === 48000 && whole.channelData[0]?.length === 12000, 'whole-file length')
	let files = await decoder()
	for (let i = 0; i < 2; i++) {
		let result = files.decode(source)
		ok(result.sampleRate === 48000 && result.channelData[0]?.length === 12000, 'reusable whole-file length')
	}
	files.free()
	let dec = await decoder(), results = []
	for (let offset = 0; offset < source.length; offset += 17)
		results.push(dec.decode(source.subarray(offset, offset + 17)))
	results.push(dec.flush())
	dec.free()
	let total = results.reduce((samples, result) => samples + (result.channelData[0]?.length || 0), 0)
	ok(total === whole.channelData[0].length, 'chunked length matches whole-file')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

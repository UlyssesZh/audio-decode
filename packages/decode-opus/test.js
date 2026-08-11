import decode, { decoder } from './decode-opus.js'
import { createOpusDecoder } from './core.js'
import { parseMeta } from './meta.js'
import { readFileSync } from 'fs'
import opus from 'audio-lena/opus'

let pass = 0, fail = 0
function ok(cond, msg) {
	if (cond) { pass++; console.log('  ok', msg) }
	else { fail++; console.log('  FAIL', msg) }
}
function near(a, b, tol = 0.02) { return Math.abs(a - b) < tol }
function rms(f32) { let s = 0; for (let i = 0; i < f32.length; i++) s += f32[i] * f32[i]; return Math.sqrt(s / f32.length) }
function toneMagnitude(samples, frequency, sampleRate) {
	let real = 0, imaginary = 0
	for (let i = 0; i < samples.length; i++) {
		let phase = 2 * Math.PI * frequency * i / sampleRate
		real += samples[i] * Math.cos(phase)
		imaginary -= samples[i] * Math.sin(phase)
	}
	return Math.hypot(real, imaginary) / samples.length
}

// whole-file decode
console.log('Opus whole-file')
let whole = await decode(opus)
ok(whole.channelData.length === 1, 'mono')
ok(whole.sampleRate === 48000, 'sampleRate 48000')
ok(whole.channelData[0].length === 589044, 'granule-position trim')
ok(near(whole.channelData[0].length / whole.sampleRate, 12.27), 'duration ~12.27s')
ok(rms(whole.channelData[0]) > 0.05, 'has audio content')

console.log('Opus output gain')
{
	let gained = new Uint8Array(opus.slice(0)), signature = new TextEncoder().encode('OpusHead'), head = -1
	outer: for (let i = 0; i <= gained.length - signature.length; i++) {
		for (let j = 0; j < signature.length; j++) if (gained[i + j] !== signature[j]) continue outer
		head = i; break
	}
	gained[head + 16] = 0; gained[head + 17] = 6 // +6 dB in signed Q8
	let withGain = await decode(gained)
	ok(near(rms(withGain.channelData[0]) / rms(whole.channelData[0]), 10 ** (6 / 20)), '+6 dB gain applied')
}

// streaming decoder
console.log('Opus streaming')
{
	let dec = await decoder()
	let buf = new Uint8Array(opus), results = [], sync = true
	for (let offset = 0, size = 1; offset < buf.length; offset += size, size = Math.min(size * 3, 7919)) {
		let chunk = buf.subarray(offset, offset + size)
		let result = dec.decode(offset ? chunk : chunk.slice().buffer)
		sync &&= !(result instanceof Promise)
		results.push(result)
	}
	ok(sync, 'decode returns value, not promise')
	let tail = dec.flush()
	ok(!(tail instanceof Promise), 'flush returns value, not promise')
	results.push(tail)
	let total = results.reduce((samples, result) => samples + (result.channelData[0]?.length || 0), 0)
	ok(total === whole.channelData[0].length, 'chunked decode matches whole-file length')
	let threw = false
	try { dec.decode(buf) } catch { threw = true }
	ok(threw, 'decode after flush throws')
	ok(dec.flush().channelData.length === 0, 'second flush is empty')
	dec.free()
}

console.log('Opus lifecycle')
{
	let dec = await decoder()
	ok(dec.decode(null).channelData.length === 0, 'null chunk is empty')
	ok(dec.decode(new Uint8Array()).channelData.length === 0, 'empty chunk is empty')
	dec.free(); dec.free()
	let threw = false
	try { dec.decode(new Uint8Array([1])) } catch { threw = true }
	ok(threw, 'decode after free throws')
}

console.log('Opus core')
{
	let core = await createOpusDecoder()
	let threw = false
	try { core.configure({ channels: 0 }) } catch (error) { threw = error instanceof RangeError }
	ok(threw, 'rejects invalid configuration')
	threw = false
	try { core.configure({ channels: 1, streamCount: 0x100000001, coupledStreamCount: 0, channelMappingTable: [0] }) } catch (error) { threw = error instanceof RangeError }
	ok(threw, 'rejects stream counts that would wrap at the WASM boundary')
	threw = false
	try { core.configure({ channels: 1, channelMappingTable: Array(1) }) } catch { threw = true }
	ok(threw, 'rejects sparse channel mappings')
	core.configure({ channels: 1, streamCount: 1, coupledStreamCount: 0, channelMappingTable: [0] })
	let malformed = core.decodeFrames([new Uint8Array([255])])
	ok(malformed.errors[0]?.message.includes('OPUS_INVALID_PACKET'), 'reports malformed packet')
	ok(malformed.channelData.length === 0, 'malformed packet has no output')
	let empty = core.decodeFrames([new Uint8Array(0)])
	ok(empty.errors[0]?.message.includes('OPUS_INVALID_PACKET'), 'empty packet reports error, no concealment')
	ok(empty.samplesDecoded === 0, 'empty packet decodes no samples')
	core.unconfigure()
	threw = false
	try { core.decodeFrames([]) } catch { threw = true }
	ok(threw, 'decode requires configuration')
	core.free(); core.free()
	threw = false
	try { core.configure({ channels: 1 }) } catch { threw = true }
	ok(threw, 'configure after free throws')
}

console.log('Opus surround')
{
	let source = readFileSync(new URL('./fixtures/surround.opus', import.meta.url))
	let result = await decode(source)
	ok(result.channelData.length === 6, '5.1 channels')
	ok(result.channelData.every(channel => channel.length > 0), 'all channels decoded')
	ok(result.channelData.every(channel => channel.every(Number.isFinite)), 'finite samples')
	let tones = [220, 440, 330, 660, 770]
	ok(tones.every((frequency, channel) => toneMagnitude(result.channelData[channel], frequency, result.sampleRate) > 0.04), '5.1 channel mapping order')
	ok(rms(result.channelData[5]) < 0.01, 'LFE remains in the sixth channel')
}

console.log('Opus concurrent')
{
	let results = await Promise.all([decode(opus), decode(opus), decode(opus)])
	ok(results.every(result => result.channelData[0].length === whole.channelData[0].length), 'three decoders')
}

// ===== metadata (OpusTags) =====
console.log('Opus metadata')
{
	let { meta, sampleRate } = parseMeta(readFileSync(new URL('./fixtures/tagged.opus', import.meta.url)))
	ok(sampleRate === 48000, 'sampleRate 48000 (Opus decode rate)')
	ok(meta.title === 'Lena Sine', 'title')
	ok(meta.artist === 'audiojs', 'artist')
	ok(meta.album === 'Fixtures', 'album')
	ok(meta.track === '3', 'track (from TRACKNUMBER)')
	ok(Array.isArray(meta.pictures), 'pictures array present')
	ok(parseMeta(new Uint8Array([1, 2, 3, 4])) === null, 'non-ogg → null')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

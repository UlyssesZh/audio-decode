import decode, { decoder } from './decode-qoa.js'
import { readFileSync } from 'fs'

let pass = 0, fail = 0
function ok(cond, msg) {
	if (cond) { pass++; console.log('  ok', msg) }
	else { fail++; console.log('  FAIL', msg) }
}

let qoa = readFileSync(new URL('../../fixtures/qoa-sample.qoa', import.meta.url))

// whole-file decode
console.log('QOA whole-file')
{
	let r = await decode(qoa)
	ok(r.channelData.length >= 1, 'has channels')
	ok(r.sampleRate > 0, 'sampleRate: ' + r.sampleRate)
	ok(r.channelData[0].length > 0, 'has samples: ' + r.channelData[0].length)
}

// decoder interface
console.log('QOA decoder')
{
	let dec = await decoder()
	let r = dec.decode(qoa)
	ok(r.channelData.length >= 1, 'has channels')
	ok(r.sampleRate > 0, 'sampleRate: ' + r.sampleRate)
	let f = dec.flush()
	ok(f.channelData.length === 0, 'flush empty')
	dec.free()
}

// streaming mode (qoa.h: file header samples = 0, frames until the end) and chunked decode
console.log('QOA streaming mode, chunked')
{
	let whole = decode(qoa)
	let live = new Uint8Array(qoa); live[4] = live[5] = live[6] = live[7] = 0
	let r = decode(live)
	ok(r.channelData[0].length === whole.channelData[0].length && r.channelData[0].every((v, i) => v === whole.channelData[0][i]), 'samples: 0 decodes every frame, same samples')
	let dec = decoder(), n = 0
	for (let i = 0; i < qoa.length; i += 777) n += dec.decode(qoa.subarray(i, i + 777)).channelData[0]?.length || 0
	ok(n === whole.channelData[0].length, 'chunked (777 bytes) yields every sample: ' + n)
}

// sync API
console.log('QOA sync')
{
	let r = decode(qoa)
	ok(!(r instanceof Promise), 'decode returns value, not promise')
	ok(r.channelData.length >= 1, 'has channels')
	ok(r.channelData[0].length > 0, 'has samples')

	let dec = decoder()
	ok(!(dec instanceof Promise), 'decoder returns instance, not promise')
	let input = qoa.buffer.slice(qoa.byteOffset, qoa.byteOffset + qoa.byteLength)
	let r2 = dec.decode(input)
	ok(r2.channelData[0].length === r.channelData[0].length, 'decoder: ArrayBuffer has same frames')
	dec.free()
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

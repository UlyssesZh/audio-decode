// GSM 06.10 decode against two decoders: SoX 14.4.2's libgsm and FFmpeg 8.0.1's own (libavcodec/gsmdec.c), on
// fixtures/lena-2s.gsm (SoX's encode of 2 s of audio-lena at 8 kHz): the same samples, every one.
import t, { is, ok } from 'tst'
import { readFileSync } from 'node:fs'
import decode, { decoder } from './decode-gsm.js'

const fix = f => readFileSync(new URL('./fixtures/' + f, import.meta.url))
const pcm16 = (buf, at = 0, len = buf.length - at) => new Int16Array(buf.buffer.slice(buf.byteOffset + at, buf.byteOffset + at + len))
const wavData = buf => { let d = buf.indexOf('data'); return pcm16(buf, d + 8, buf.readUInt32LE(d + 4)) }
const s16 = x => Int16Array.from(x, v => Math.round(v * 32768))

t('decode: the samples SoX and FFmpeg decode, every one', async () => {
	let { channelData, sampleRate } = await decode(fix('lena-2s.gsm'))
	is(sampleRate, 8000)
	is(channelData.length, 1, 'mono')
	is(channelData[0].length, 16000, '100 frames of 160')
	let y = s16(channelData[0]), sox = wavData(fix('lena-2s.sox.wav')), ff = pcm16(fix('lena-2s.ffmpeg.raw'))
	is(y, sox, 'as SoX (libgsm)')
	is(y, ff, 'as FFmpeg')
})

t('decoder: bytes split anywhere, frames decoded as they complete', async () => {
	let bytes = fix('lena-2s.gsm'), whole = (await decode(bytes)).channelData[0]
	let d = await decoder(), parts = []
	for (let o = 0, k = 1; o < bytes.length; o += k, k = k * 7 % 97 + 1) parts.push(d.decode(bytes.subarray(o, o + k)).channelData[0])
	parts.push(d.flush().channelData[0])
	d.free()
	let y = new Float32Array(parts.reduce((s, p) => s + p.length, 0)), o = 0
	for (let p of parts) { y.set(p, o); o += p.length }
	is(y, whole, 'the same as at once')
})

t('decode: a frame without the GSM signature is an error', async () => {
	let bytes = fix('lena-2s.gsm').slice(0, 66)
	bytes[33] = 0
	let threw = false
	try { await decode(bytes) } catch (e) { threw = /frame 1/.test(e.message) }
	ok(threw, 'frame 1 named')
})

t('decoder: nothing, a partial frame held for the next bytes, dropped at the end', async () => {
	let bytes = fix('lena-2s.gsm'), d = await decoder()
	is(d.decode(new Uint8Array(0)).channelData[0].length, 0, 'no bytes: no samples')
	is(d.decode(bytes.subarray(0, 32)).channelData[0].length, 0, '32 bytes: not a frame yet')
	is(d.decode(bytes.subarray(32, 33)).channelData[0].length, 160, 'the 33rd: one frame')
	is(d.decode(bytes.subarray(33, 50)).channelData[0].length, 0, 'part of the next')
	is(d.flush().channelData[0].length, 0, 'dropped at the end: GSM has no partial frames')
	d.free()
	is((await decode(new Uint8Array(0))).channelData[0].length, 0, 'an empty file')
})

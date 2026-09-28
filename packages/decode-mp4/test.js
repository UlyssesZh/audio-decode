import t, { is, ok } from 'tst'
import decode, { decoder } from './decode-mp4.js'
import wav from '@audio/decode-wav'
import { readFileSync } from 'fs'

const fx = n => new Uint8Array(readFileSync(new URL('./fixtures/' + n, import.meta.url)))
const ref = await wav(fx('ref.wav')) // 0.5 s stereo 48 kHz: 440 Hz left, 880 Hz right

const rms = d => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length) }
// best SNR (dB) of `out` against `src` over codec-delay lags — out may lead by priming samples
function snr(src, out, maxLag = 3000) {
	let best = -Infinity, n = Math.min(8000, src.length)
	for (let lag = 0; lag <= maxLag; lag++) {
		if (lag + n > out.length) break
		let e = 0, s = 0
		for (let i = 0; i < n; i++) { let d = src[i] - out[i + lag]; e += d * d; s += src[i] * src[i] }
		best = Math.max(best, 10 * Math.log10(s / e))
	}
	return best
}
const exact = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-4) return false; return true }

const lossy = ['video-aac.mp4', 'video-aac.mov', 'video-aac.3gp', 'video-mp3.mp4', 'video-opus.mp4', 'video-ac3.mp4', 'video-dts.mp4']
const lossless = ['video-flac.mp4', 'video-alac.mov', 'video-pcm16.mov', 'video-pcm16be.mov', 'video-pcm24.mov', 'video-f32.mov', 'video-pcm16.mp4']

for (let name of lossy) t(name + ' — audio track from video, lossy', async () => {
	let r = await decode(fx(name))
	is(r.channelData.length, 2)
	is(r.sampleRate, 48000)
	let dur = r.channelData[0].length / r.sampleRate
	ok(dur >= 0.5 && dur < 0.6, 'duration ' + dur.toFixed(3))
	for (let c = 0; c < 2; c++) ok(snr(ref.channelData[c], r.channelData[c]) > 15, 'ch' + c + ' SNR ' + snr(ref.channelData[c], r.channelData[c]).toFixed(1) + ' dB')
})

for (let name of lossless) t(name + ' — audio track from video, bit-exact', async () => {
	let r = await decode(fx(name))
	is(r.channelData.length, 2)
	is(r.sampleRate, 48000)
	is(r.channelData[0].length, ref.channelData[0].length, 'sample count')
	for (let c = 0; c < 2; c++) ok(exact(ref.channelData[c], r.channelData[c]), 'ch' + c + ' identical to reference')
})

t('video-eac3.mp4 — E-AC-3 track routes to @audio/decode-eac3', async () => {
	let r = await decode(fx('video-eac3.mp4'))
	is(r.sampleRate, 48000, 'E-AC-3 is always 48 kHz')
	is(r.channelData.length, 2, 'stereo')
	// tones as in the other video fixtures: 440 Hz left, 880 Hz right (Goertzel pick among candidates)
	let tone = d => [220, 440, 880, 1760].map(f => {
		let w = 2 * Math.PI * f / r.sampleRate, c = 2 * Math.cos(w), s0 = 0, s1 = 0, s2 = 0
		for (let i = 2000; i < Math.min(d.length, 22000); i++) { s0 = d[i] + c * s1 - s2; s2 = s1; s1 = s0 }
		return [f, s1 * s1 + s2 * s2 - c * s1 * s2]
	}).sort((a, b) => b[1] - a[1])[0][0]
	is(tone(r.channelData[0]), 440, 'left tone')
	is(tone(r.channelData[1]), 880, 'right tone')
})

t('streaming: chunks equal whole-file (moov after mdat, 1000-byte chunks)', async () => {
	for (let name of ['video-aac.mov', 'video-pcm16.mov', 'video-pcm16.mp4']) {
		let bytes = fx(name), whole = await decode(bytes)
		let dec = await decoder(), parts = []
		for (let i = 0; i < bytes.length; i += 1000) {
			let r = await dec.decode(bytes.subarray(i, i + 1000))
			if (r.channelData.length) parts.push(r)
		}
		let tail = await dec.flush()
		if (tail.channelData.length) parts.push(tail)
		let len = parts.reduce((n, p) => n + p.channelData[0].length, 0)
		is(len, whole.channelData[0].length, name + ' sample count')
		let out = new Float32Array(len), off = 0
		for (let p of parts) { out.set(p.channelData[1], off); off += p.channelData[1].length }
		ok(exact(out, whole.channelData[1]), name + ' samples identical')
	}
})

// Fragmented files (ISO/IEC 14496-12 §8.8), made by FFmpeg (-movflags frag_keyframe+empty_moov,
// 100 ms fragments): the samples live in moof+mdat pairs, read the same whole or chunked
t('fragmented: moof+mdat samples decode, whole and in 1000-byte chunks', async () => {
	for (let [f, same] of [['frag-flac.mp4', exact], ['frag-pcm16.mp4', exact], ['frag-aac.mp4', null]]) {
		let buf = fx(f), whole = await decode(buf)
		is(whole.sampleRate, 48000, f + ': rate')
		if (same) ok(same(whole.channelData[0], ref.channelData[0]) && same(whole.channelData[1], ref.channelData[1]), f + ': lossless ≡ ref.wav')
		else ok(whole.channelData[0].length >= ref.channelData[0].length && Math.abs(rms(whole.channelData[0]) - rms(ref.channelData[0])) < 0.02, f + ': aac, loudness kept')
		let dec = await decoder(), parts = []
		for (let i = 0; i < buf.length; i += 1000) { let r = await dec.decode(buf.subarray(i, i + 1000)); if (r.channelData.length) parts.push(r.channelData[0]) }
		let r = await dec.flush(); if (r.channelData.length) parts.push(r.channelData[0])
		dec.free()
		let n = parts.reduce((t, p) => t + p.length, 0)
		is(n, whole.channelData[0].length, f + ': chunked ≡ whole')
	}
})

// Gapless AAC: Apple's encoders prime 2112 samples, FAAD2 withholds 1024; the edit list (ISO/IEC 14496-12
// §8.6.6) or iTunes' iTunSMPB say where the audio starts and how long it lasts. Fixtures: a 44137-sample chirp
// (100 Hz up 1950 Hz/s, 0.4 peak) through AudioToolbox AAC-LC 64 kbps, by afconvert (iTunSMPB) and by ffmpeg's
// aac_at (edit list, media_time 2112). Before, both decoded 1088 samples late and 2048 (afconvert) longer.
const chirp = n => Float32Array.from({ length: n }, (_, i) => { let t = i / 44100; return 0.4 * Math.sin(2 * Math.PI * (100 * t + 1950 * t * t)) })
function lagOf(src, out, max = 2500) { // out[i + lag] ≈ src[i]: the lag of the correlation peak
	let best = -Infinity, bl = 0
	for (let d = -max; d <= max; d++) { let s = 0; for (let i = 5000; i < Math.min(35000, src.length); i++) s += src[i] * (out[i + d] || 0); if (s > best) best = s, bl = d }
	return bl
}
for (let [name, exactLength] of [['gapless-itunsmpb.m4a', true], ['gapless-elst.m4a', false]]) t(name + ': starts on the source\'s first sample, ends on its last', async () => {
	let src = chirp(44137), out = (await decode(fx(name))).channelData[0]
	is(lagOf(src, out), 0, 'no lag')
	// the edit-list fixture's own durations (stts, the edit's milliseconds) run past the true end: the file
	// carries no exact length, so only the start is pinned there
	if (exactLength) is(out.length, src.length, 'length (iTunSMPB)')
	else ok(out.length >= src.length && out.length < src.length + 1024, 'length within the last frame: ' + out.length)
})

// MP3 samples carry no LAME tag: the edit list trims LAME's delay and the decoder's (1105, as ffmpeg writes it) and
// the padding. Fixture: the chirp's first 22050 samples through ffmpeg's libmp3lame (ffmpeg -f lavfi -i
// "aevalsrc=0.4*sin(2*PI*(100*t+1950*t*t)):s=44100:d=0.5" -c:a libmp3lame -b:a 64k -fflags +bitexact -f mp4).
t('gapless-mp3.mp4: MP3 starts on the source\'s first sample, ends on its last', async () => {
	let src = chirp(22050), out = (await decode(fx('gapless-mp3.mp4'))).channelData[0]
	is(lagOf(src, out), 0, 'no lag')
	is(out.length, src.length, 'length')
})

// The window is the edit list's one media edit: an empty edit (media_time -1, a delay) beside it leaves the window as
// is; several media edits cut or repeat the media, which is no trim, so the track decodes whole as without edits
t('edit lists: an empty edit keeps the gapless window, several media edits decode whole', async () => {
	let buf = fx('gapless-elst.m4a'), len = async list => (await decode(edited(buf, list))).channelData[0].length
	let gap = (await decode(buf)).channelData[0].length, whole = await len([])
	ok(whole > gap + 2000, `whole ${whole}, windowed ${gap}`)
	is(await len([[500, -1], [1022, 2112]]), gap, 'empty edit, then the media edit: the window')
	is(await len([[511, 2112], [511, 2112 + 22528]]), whole, 'two media edits: whole')
})
// the file with its elst entries replaced by [duration, media_time] pairs (its moov follows mdat: no offset moves)
function edited(buf, list) {
	let dv = new DataView(buf.buffer, buf.byteOffset), at = {}
	let walk = (s, e) => { for (let o = s; o < e; o += dv.getUint32(o)) { let t = String.fromCharCode(...buf.subarray(o + 4, o + 8)); at[t] = o; if (/moov|trak|edts/.test(t)) walk(o + 8, o + dv.getUint32(o)) } }
	walk(0, buf.length)
	let e = at.elst, grow = 12 * (list.length - dv.getUint32(e + 12)), out = new Uint8Array(buf.length + grow), w = new DataView(out.buffer)
	out.set(buf.subarray(0, e + 16)); out.set(buf.subarray(e + dv.getUint32(e)), e + 16 + 12 * list.length)
	for (let t of ['moov', 'trak', 'edts', 'elst']) w.setUint32(at[t], dv.getUint32(at[t]) + grow)
	w.setUint32(e + 12, list.length)
	list.forEach(([d, m], i) => { w.setUint32(e + 16 + 12 * i, d); w.setInt32(e + 20 + 12 * i, m); w.setUint32(e + 24 + 12 * i, 0x10000) })
	return out
}

// Opus mapping family 1 codes 5.1 in Vorbis order (FL 220, C 440, FR 330, RL 660, RR 770, LFE); out in SMPTE/WAV
// order, as decode-opus gives Ogg Opus. Fixture: decode-opus's surround.opus, remuxed (ffmpeg -c copy -f mp4).
t('surround-opus.mp4: 5.1 Opus in SMPTE order: L R C LFE Ls Rs', async () => {
	let r = await decode(fx('surround-opus.mp4'))
	let mag = (d, f) => { let re = 0, im = 0; for (let i = 0; i < d.length; i++) { let p = 2 * Math.PI * f * i / r.sampleRate; re += d[i] * Math.cos(p); im -= d[i] * Math.sin(p) } return Math.hypot(re, im) / d.length }
	let tones = r.channelData.map(d => { let [f, m] = [220, 330, 440, 660, 770].map(f => [f, mag(d, f)]).sort((a, b) => b[1] - a[1])[0]; return m > 0.01 ? f : 0 })
	is(tones, [220, 330, 440, 0, 660, 770])
})

t('rejects non-MP4 and empty input', async () => {
	let err
	try { await decode(new Uint8Array(100)) } catch (e) { err = e }
	ok(err, 'garbage throws: ' + err?.message)
	err = null
	try { await decode('nope') } catch (e) { err = e }
	ok(err instanceof TypeError)
})

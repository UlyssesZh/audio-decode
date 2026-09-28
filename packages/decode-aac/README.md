# @audio/decode-aac

Decode AAC/M4A and ALAC audio to PCM float samples. FAAD2 WASM handles AAC; a pure-JS port of Apple's reference decoder handles ALAC. The M4A sample entry selects the codec.

## Install

```
npm i @audio/decode-aac
```

## Usage

```js
import decode from '@audio/decode-aac'

// M4A or raw ADTS; auto-detected
let { channelData, sampleRate } = await decode(uint8array)
// channelData: Float32Array[] (one per channel)
// sampleRate: number
```

### Streaming

```js
import { decoder } from '@audio/decode-aac'

let dec = await decoder()
let { channelData, sampleRate } = dec.decode(chunk)
dec.free()
```

`decoder()` is asynchronous. Its `decode()` and `flush()` methods are synchronous.

## API

### `decode(src: Uint8Array | ArrayBuffer): Promise<AudioData>`

Whole-file decode. Auto-detects M4A (MP4 container) vs raw ADTS.

### `decoder(opts?): Promise<AACDecoder>`

Creates a decoder instance for manual control.

- `dec.decode(data)`: decode a `Uint8Array` or `ArrayBuffer` chunk.
- `dec.flush()`: discard buffered partial data and return an empty result.
- `dec.free()`: release WASM memory.

Without options the byte stream is auto-detected (M4A or ADTS). Container demuxers that hold the codec config out-of-band pass it up-front and feed raw access units — one frame, or an array of frames, per `decode()` call:

```js
let dec = await decoder({ asc })   // AudioSpecificConfig (esds, Matroska CodecPrivate, WAVEFORMATEX extra bytes)
let dec = await decoder({ alac })  // ALAC magic cookie
```

This is how [@audio/decode-mp4](../decode-mp4), [@audio/decode-webm](../decode-webm) and [@audio/decode-avi](../decode-avi) decode AAC and ALAC tracks from video files.

### Gapless

An M4A is decoded gapless: the encoder's priming (Apple's encoders: 2112 samples) and padding are trimmed, so the output has the source's length and timing. The track's edit list says where the presentation starts when it has one media edit ([ISO/IEC 14496-12](https://www.iso.org/standard/83102.html) §8.6.6; several are an edit, not a trim: the track decodes whole), else iTunes' `iTunSMPB` tag; FAAD2's own delay (it withholds its first frame; SBR delays HE-AAC 962 samples more) is accounted for. A raw ADTS stream carries no such information and keeps the decoder's delay. A demuxer passes the window it read from its container:

```js
import { decoder, gapless } from '@audio/decode-aac'
let dec = await decoder({ asc, gapless: gapless({ elst, mdhd, stts, mvhd, ilst, asc }) })  // box bodies
// or directly: { gapless: { start, duration } } in seconds of the media timeline
```

### `AudioData`

```ts
{ channelData: Float32Array[], sampleRate: number }
```

## Formats

- M4A / MP4 / MOV with AAC audio (LC and HE-AAC v1/v2 with SBR or PS) — QuickTime sound descriptions v0, v1 and v2
- M4A / MP4 with bit-exact pure-JS ALAC decoding at 16, 20, 24, or 32 bits
- Raw ADTS streams (.aac)

## Metadata

```js
import { parseMeta } from '@audio/decode-aac/meta'

let { meta, sampleRate } = parseMeta(m4aBytes)
// meta: { title, artist, album, year, genre, track, ..., pictures }
```

## License

[ॐ](https://github.com/krishnized/license/) · AAC decoding [GPL-2.0](./LICENSE) (FAAD2), ALAC decoding Apache-2.0 (port of Apple's ALAC reference)

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

### `decoder(): Promise<AACDecoder>`

Creates a decoder instance for manual control.

- `dec.decode(data)`: decode a `Uint8Array` or `ArrayBuffer` chunk.
- `dec.flush()`: discard buffered partial data and return an empty result.
- `dec.free()`: release WASM memory.

### `AudioData`

```ts
{ channelData: Float32Array[], sampleRate: number }
```

## Formats

- M4A / MP4 with AAC audio (LC and HE-AAC v1/v2 with SBR or PS)
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

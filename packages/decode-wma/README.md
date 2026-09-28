# @audio/decode-wma

Decode WMA audio to PCM float samples. The package combines a pure-JS ASF demuxer with FFmpeg's WMA decoders (`wmav1`, `wmav2`, `wmapro`, `wmalossless`), a slim LGPL-2.1-or-later `libavcodec` build compiled to WASM. Output matches FFmpeg's to float precision.

## Install

```
npm i @audio/decode-wma
```

## Usage

```js
import decode from '@audio/decode-wma'

let { channelData, sampleRate } = await decode(wmaBuffer)
```

### Streaming

```js
import { decoder } from '@audio/decode-wma'

let dec = await decoder()
let result = dec.decode(chunk)
dec.free()
```

`decoder()` is asynchronous. Its `decode()` and `flush()` methods are synchronous.

### ASF demuxer only

```js
import { demuxASF } from '@audio/decode-wma'

let { channels, sampleRate, bitRate, packets } = demuxASF(buffer)
```

## API

### `decode(src): Promise<AudioData>`

Whole-file decode. Accepts `Uint8Array` or `ArrayBuffer`.

### `decoder(): Promise<WMADecoder>`

Creates a decoder instance.

- `dec.decode(data)`: decode a `Uint8Array` or `ArrayBuffer` chunk.
- `dec.flush()`: decode a buffered variable-size packet or return an empty result.
- `dec.free()`: release WASM memory.

### `demuxASF(buf): ASFInfo`

Parse ASF container without decoding. Returns stream properties and raw packets.

## Formats

- WMA v1 (0x0160)
- WMA v2 (0x0161)
- WMA Pro (0x0162)
- WMA Lossless (0x0163)

## Building WASM

```
npm run build
```

`build.sh` configures FFmpeg from the shared [`lib/ffmpeg`](../../lib/ffmpeg) submodule (`release/7.1`, as [`@audio/decode-eac3`](../decode-eac3) and [`@audio/decode-ape`](../decode-ape)) with only the four WMA decoders, and links the glue in `src/wma_glue.c`.

## License

[ॐ](https://github.com/krishnized/license/) · [LGPL-2.1-or-later](./LICENSE), inherited from the bundled [FFmpeg](https://ffmpeg.org/legal.html) WMA decoders (FFmpeg `release/7.1` at commit [`3978a28`](https://github.com/FFmpeg/FFmpeg/commit/3978a28d5bdded4ce7eff2535c920326b5c8f2fc), built without `--enable-gpl`; see [`build.sh`](./build.sh) and [`LICENSE.ffmpeg`](./LICENSE.ffmpeg)). Corresponding source: that FFmpeg commit, with [`build.sh`](./build.sh) and [`src/wma_glue.c`](./src/wma_glue.c).

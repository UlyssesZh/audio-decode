# @audio/decode-wma

Decode WMA audio to PCM float samples. The package combines a pure-JS ASF demuxer with the [RockBox](https://www.rockbox.org/) fixed-point decoder compiled to WASM.

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

WMA Pro and Lossless are not supported. An FFmpeg-based build is available via `build-ffmpeg.sh` for those formats.

## Building WASM

```
npm run build
```

RockBox source is included in `lib/rockbox-wma/` (3 files, 152 KB).

## License

[ॐ](https://github.com/krishnized/license/) · [GPL-2.0+](./LICENSE) (RockBox)

# @audio/decode-aiff

Decode AIFF and AIFF-C audio to PCM float samples.

## Install

```
npm i @audio/decode-aiff
```

## Usage

```js
import decode, { decoder } from '@audio/decode-aiff'

let { channelData, sampleRate } = decode(aiffBytes)

let dec = decoder()
let result = dec.decode(chunk)
dec.free()
```

`decode()` and `decoder()` are synchronous.

## API

### `decode(src): AudioData`

Decode a complete `Uint8Array` or `ArrayBuffer`.

### `decoder(): AIFFDecoder`

Create a decoder instance.

- `dec.decode(data)`: decode a chunk.
- `dec.flush()`: decode buffered `ima4` or `GSM` data; otherwise return an empty result.
- `dec.free()`: release resources.

## Formats

- AIFF: 8, 16, 24, and 32-bit signed big-endian PCM.
- AIFF-C: `NONE`/`twos`, `sowt`, `fl32`, `fl64`, `alaw`, `ulaw`, `ima4`, and `GSM`.

## License

[ॐ](https://github.com/krishnized/license/) · [MIT](./LICENSE)

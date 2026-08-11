# @audio/decode-caf

Decode Core Audio Format audio to PCM float samples.

## Install

```
npm i @audio/decode-caf
```

## Usage

```js
import decode, { decoder } from '@audio/decode-caf'

let { channelData, sampleRate } = decode(cafBytes)

let dec = decoder()
let result = dec.decode(chunk)
dec.free()
```

`decode()` and `decoder()` are synchronous.

## API

### `decode(src): AudioData`

Decode a complete `Uint8Array` or `ArrayBuffer`.

### `decoder(): CAFDecoder`

Create a decoder instance.

- `dec.decode(data)`: decode a chunk.
- `dec.flush()`: discard buffered partial data and return an empty result.
- `dec.free()`: release resources.

## Formats

- `lpcm`: 8, 16, 24, and 32-bit signed integer; 32 and 64-bit float; little-endian or big-endian.
- `alaw`: G.711 A-law.
- `ulaw`: G.711 µ-law.
- `ima4`: IMA/QuickTime ADPCM.

## License

[ॐ](https://github.com/krishnized/license/) · [MIT](./LICENSE)

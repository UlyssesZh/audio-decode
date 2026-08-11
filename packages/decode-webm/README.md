# @audio/decode-webm

Decode WebM Opus and Vorbis audio to PCM float samples.

## Install

```
npm i @audio/decode-webm
```

## Usage

```js
import decode, { decoder } from '@audio/decode-webm'

let { channelData, sampleRate } = await decode(webmBytes)

let dec = await decoder() // initialize Opus and Vorbis WASM
let result = dec.decode(chunk)
let tail = dec.flush()
dec.free()
```

## API

### `decode(src): Promise<AudioData>`

Decode a complete `Uint8Array` or `ArrayBuffer`.

### `decoder(): Promise<WebmDecoder>`

Initialize the codec runtimes and return a streaming decoder. Its `decode()` and `flush()` methods are synchronous. `flush()` ends the stream.

WebM identifies its audio codec in the EBML header. The factory prepares both runtimes, then releases the unused one after reading that header.

## Codecs

- Opus uses the local libopus WASM core from `@audio/decode-opus`.
- Vorbis uses `@audio/decode-vorbis`.

## License

[ॐ](https://github.com/krishnized/license/) · [MIT](./LICENSE). Bundled [libopus](https://opus-codec.org/) is [BSD 3-Clause](./LICENSE.libopus).

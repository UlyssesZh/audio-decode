# @audio/decode-opus

Decode Ogg Opus audio to PCM samples with libopus WASM.

```js
import decode, { decoder } from '@audio/decode-opus'

let { channelData, sampleRate } = await decode(opusBytes)

let dec = await decoder() // initialize WASM
let a = dec.decode(chunk1)
let b = dec.decode(chunk2)
let tail = dec.flush()
dec.free()
```

`decoder()` is asynchronous. Its `decode()` and `flush()` methods are synchronous. `flush()` ends the stream.

## Metadata

Read OpusTags metadata and cover art without decoding audio:

```js
import { parseMeta } from '@audio/decode-opus/meta'

let { meta, sampleRate } = parseMeta(opusBytes)
// meta: { title, artist, album, year, genre, ..., pictures }
```

## License

[ॐ](https://github.com/krishnized/license/) · [MIT](./LICENSE). Bundled [libopus](https://opus-codec.org/) is [BSD 3-Clause](./LICENSE.libopus).

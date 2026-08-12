# @audio/decode-vorbis

Decode Ogg Vorbis audio with [@wasm-audio-decoders/ogg-vorbis](https://github.com/eshaz/wasm-audio-decoders).

```js
import decode, { decoder } from '@audio/decode-vorbis'

let { channelData, sampleRate } = await decode(oggBytes)

let dec = await decoder() // initialize WASM
let a = dec.decode(chunk1)
let b = dec.decode(chunk2)
let tail = dec.flush()
dec.free()
```

`decoder()` initializes asynchronously. `decode()` and `flush()` are synchronous.
`decode()` accepts consecutive complete Ogg files. For chunked input, `flush()` ends
the decoder.

## Metadata

Read Vorbis comments and cover art without decoding audio:

```js
import { parseMeta } from '@audio/decode-vorbis/meta'

let { meta, sampleRate } = parseMeta(oggBytes)
```

## License

[ॐ](https://github.com/krishnized/license/) · [MIT](./LICENSE)

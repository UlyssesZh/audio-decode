# @audio/decode-flac

Decode raw FLAC and Ogg FLAC audio with [@wasm-audio-decoders/flac](https://github.com/eshaz/wasm-audio-decoders).

```js
import decode, { decoder } from '@audio/decode-flac'

let { channelData, sampleRate } = await decode(flacBytes)

let dec = await decoder() // initialize WASM
let a = dec.decode(chunk1)
let b = dec.decode(chunk2)
let tail = dec.flush()
dec.free()
```

`decoder()` is asynchronous. Its `decode()` and `flush()` methods are synchronous. `flush()` ends the stream.

## License

[ॐ](https://github.com/krishnized/license/) · [MIT](./LICENSE)

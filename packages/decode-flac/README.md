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

`decoder()` initializes asynchronously. `decode()` and `flush()` are synchronous.
`decode()` accepts consecutive complete Ogg files and raw FLAC files whose STREAMINFO
block declares the sample total. For chunked input, `flush()` ends the decoder.

## License

[ॐ](https://github.com/krishnized/license/) · [MIT](./LICENSE)

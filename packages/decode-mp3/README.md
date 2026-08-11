# @audio/decode-mp3

Decode MP3 audio with [mpg123-decoder](https://github.com/eshaz/wasm-audio-decoders/tree/main/src/mpg123-decoder).

```js
import decode, { decoder } from '@audio/decode-mp3'

let { channelData, sampleRate } = await decode(mp3Bytes)

let dec = await decoder() // initialize WASM
let a = dec.decode(chunk1)
let b = dec.decode(chunk2)
dec.free()
```

`decoder()` is asynchronous. Its `decode()` method is synchronous.

## License

[ॐ](https://github.com/krishnized/license/) · [MIT](./LICENSE)

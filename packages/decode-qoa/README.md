# @audio/decode-qoa

Decode QOA (Quite OK Audio) to PCM samples with [qoa-format](https://github.com/nicokoenig/qoa-format).

```js
import decode, { decoder } from '@audio/decode-qoa'

let { channelData, sampleRate } = decode(qoaBytes)

let dec = decoder()
let result = dec.decode(completeQoaFile)
dec.free()
```

`decode()` and `decoder()` are synchronous. The decoder is stateless, so every chunk must contain a complete QOA file.

## License

[ॐ](https://github.com/krishnized/license/) · [MIT](./LICENSE)

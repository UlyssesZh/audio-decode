# @audio/decode-qoa

Decode QOA (Quite OK Audio) to PCM samples with [qoa-format](https://github.com/nicokoenig/qoa-format).

```js
import decode, { decoder } from '@audio/decode-qoa'

let { channelData, sampleRate } = decode(qoaBytes)

let dec = decoder()
let result = dec.decode(completeQoaFile)
dec.free()
```

`decode()` and `decoder()` are synchronous. The decoder takes chunks of any size and returns the frames they complete (each QOA frame carries its own LMS state). A header with `samples: 0` is QOA's streaming mode: frames decode until the data ends.

## License

[ॐ](https://github.com/krishnized/license/) · [MIT](./LICENSE)

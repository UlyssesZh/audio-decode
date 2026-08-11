# @audio/decode-wav

Decode WAV/RIFF audio in pure JavaScript. Supports PCM, float, A-law, µ-law, IMA ADPCM, and MS ADPCM.

```
npm install @audio/decode-wav
```

```js
import decode, { decoder } from '@audio/decode-wav'

let { channelData, sampleRate } = decode(bytes)

let dec = decoder()
let result = dec.decode(chunk)
dec.free()
```

`decode()` and `decoder()` are synchronous. The `./meta` subpath reads embedded metadata. The `./audio` subpath registers the codec with [`audio`](https://github.com/audiojs/audio).

## License

[ॐ](https://github.com/krishnized/license/) · [MIT](./LICENSE)

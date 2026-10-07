# @audio/decode-gsm

Decode GSM 06.10 full-rate speech (13 kbit/s, 8 kHz mono) to PCM float samples, with [libgsm](https://www.quut.com/gsm/) 1.0.22 (Jutta Degener and Carsten Bormann, TU Berlin) compiled to WASM.

## Install

```
npm i @audio/decode-gsm
```

## Usage

```js
import decode from '@audio/decode-gsm'

let { channelData, sampleRate } = await decode(gsmBytes)   // 8000 Hz, mono
```

The input is raw frames, 33 bytes each, 160 samples from each: SoX's `.gsm`, RTP payload type 3. Raw frames carry no header, so nothing detects them: name the format.

### Streaming

```js
import { decoder } from '@audio/decode-gsm'

let dec = await decoder()
let { channelData } = dec.decode(chunk)   // bytes split anywhere: whole frames as they complete
dec.free()
```

## Tested

Sample for sample the output of SoX 14.4.2 (its libgsm) and of FFmpeg 8.0.1's own decoder, on a fixture SoX encoded.

## License

MIT; libgsm under its own permissive notice (in LICENSE).

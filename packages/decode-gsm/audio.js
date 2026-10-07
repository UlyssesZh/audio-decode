// audio.js manifest — codec atom, decode half: whole-buffer bytes → { channelData,
// sampleRate }. Hosts merge with the encode half (@audio/encode-gsm) by format
// name. Raw GSM frames carry no magic: hosts pick it by name (`format: 'gsm'`, a .gsm file).

import decodeFn from './decode-gsm.js'

export const gsm = {
	codec: 'gsm',
	decode: (bytes) => decodeFn(bytes),
}

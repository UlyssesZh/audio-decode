/** Decoded PCM: planar channel data + rate. */
export interface AudioData { channelData: Float32Array[], sampleRate: number }
/** @deprecated Renamed to AudioData. */
export type Decoded = AudioData
/** Decode a complete WAV file synchronously. */
export default function decode(src: Uint8Array | ArrayBuffer): AudioData
/** Create a synchronous streaming decoder. */
export function decoder(): { decode(chunk: Uint8Array | ArrayBuffer): AudioData, flush(): AudioData, free(): void }

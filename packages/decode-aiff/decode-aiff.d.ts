export interface AudioData {
  channelData: Float32Array[];
  sampleRate: number;
}

interface AIFFDecoder {
  decode(data: Uint8Array | ArrayBuffer): AudioData;
  flush(): AudioData;
  free(): void;
}

/** Decode a complete AIFF or AIFF-C file synchronously. */
export default function decode(src: ArrayBuffer | Uint8Array): AudioData;

/** Create a synchronous decoder. */
export function decoder(): AIFFDecoder;

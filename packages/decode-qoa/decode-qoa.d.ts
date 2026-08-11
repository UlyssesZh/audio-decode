export interface AudioData {
  channelData: Float32Array[];
  sampleRate: number;
}

interface QoaDecoder {
  decode(data: Uint8Array | ArrayBuffer): AudioData;
  flush(): AudioData;
  free(): void;
}

/** Decode a complete QOA file synchronously. */
export default function decode(src: ArrayBuffer | Uint8Array): AudioData;

/** Create a synchronous stateless decoder. */
export function decoder(): QoaDecoder;

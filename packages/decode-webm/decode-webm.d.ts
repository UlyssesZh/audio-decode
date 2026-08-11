export interface AudioData {
  channelData: Float32Array[];
  sampleRate: number;
}

interface WebmDecoder {
  /** Decode a WebM chunk synchronously. */
  decode(data: Uint8Array | ArrayBuffer): AudioData;
  /** Finish the stream synchronously. */
  flush(): AudioData;
  free(): void;
}

/** Decode a complete WebM audio file. */
export default function decode(src: ArrayBuffer | Uint8Array): Promise<AudioData>;

/** Initialize WASM and return a decoder with synchronous methods. */
export function decoder(): Promise<WebmDecoder>;

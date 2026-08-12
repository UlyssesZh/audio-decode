export interface AudioData {
  channelData: Float32Array[];
  sampleRate: number;
}

interface VorbisDecoder {
  /** Decode a chunk synchronously. */
  decode(data: Uint8Array | ArrayBuffer): AudioData;
  /** Finish chunked input synchronously. This ends the decoder. */
  flush(): AudioData;
  free(): void;
}

/** Decode a complete Ogg Vorbis file. */
export default function decode(src: ArrayBuffer | Uint8Array): Promise<AudioData>;

/** Initialize WASM and create a decoder with synchronous methods. */
export function decoder(): Promise<VorbisDecoder>;

export interface AudioData {
  channelData: Float32Array[];
  sampleRate: number;
}

interface GSMDecoder {
  /** whole 33-byte frames as they complete; 160 samples at 8 kHz from each */
  decode(data: Uint8Array): AudioData;
  flush(): AudioData;
  free(): void;
}

/** Whole-file decode of raw GSM 06.10 full-rate frames (SoX's .gsm) */
export default function decode(src: ArrayBuffer | Uint8Array): Promise<AudioData>;

/** Streaming decoder */
export function decoder(): Promise<GSMDecoder>;

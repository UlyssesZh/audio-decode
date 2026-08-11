export interface OpusOptions {
  sampleRate?: 8000 | 12000 | 16000 | 24000 | 48000;
  channels: number;
  streamCount?: number;
  coupledStreamCount?: number;
  channelMappingTable?: number[] | Uint8Array;
  preSkip?: number;
  outputGain?: number;
}

export interface DecodedOpus {
  errors: Array<{
    message: string;
    frameLength: number;
    frameNumber: number;
    inputBytes: number;
    outputSamples: number;
  }>;
  channelData: Float32Array[];
  samplesDecoded: number;
  sampleRate: number;
  bitDepth: 32;
}

export interface OpusPacketDecoder {
  configure(options: OpusOptions): void;
  decodeFrames(frames: Uint8Array[]): DecodedOpus;
  unconfigure(): void;
  free(): void;
}

/** Initialize libopus WASM without configuring a stream. */
export function createOpusDecoder(): Promise<OpusPacketDecoder>;

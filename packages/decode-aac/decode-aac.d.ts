export interface AudioData {
  channelData: Float32Array[];
  sampleRate: number;
}

interface AACDecoder {
  /** Byte stream (M4A/ADTS), or with `asc`/`alac` options: one raw access unit or an array of them */
  decode(data: Uint8Array | ArrayBuffer | Uint8Array[]): AudioData;
  flush(): AudioData;
  free(): void;
}

/** Whole-file decode — auto-detects M4A vs ADTS */
export default function decode(src: ArrayBuffer | Uint8Array): Promise<AudioData>;

export interface RawOptions {
  /** AudioSpecificConfig — decode raw AAC access units from a container demuxer */
  asc?: Uint8Array;
  /** ALAC magic cookie (24-byte ALACSpecificConfig, `alac` box body, or full atom) — decode raw ALAC frames */
  alac?: Uint8Array;
  /** With `asc`/`alac`: trim the encoder's priming and padding to this window, as `gapless()` reads it from the container */
  gapless?: GaplessWindow;
}

/** Seconds of the media timeline: the output starts at `start` and lasts `duration` (to the end when absent) */
export interface GaplessWindow {
  start: number;
  duration?: number;
}

/** Box bodies of an MP4 audio track (`elst` `mdhd` `stts` `mvhd` `ilst`) and its codec config (`asc` or `alac`) */
export interface GaplessBoxes {
  elst?: Uint8Array;
  mdhd?: Uint8Array;
  stts?: Uint8Array;
  mvhd?: Uint8Array;
  ilst?: Uint8Array;
  asc?: Uint8Array;
  alac?: Uint8Array;
}

/** The track's gapless window: its edit list's one media edit, else iTunes' iTunSMPB; null without either, or with several media edits */
export function gapless(boxes: GaplessBoxes): GaplessWindow | null;

/** Create streaming decoder instance. Auto-detects M4A vs ADTS, or decodes raw frames when a config is given. */
export function decoder(opts?: RawOptions): Promise<AACDecoder>;

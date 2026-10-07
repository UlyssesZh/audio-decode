export declare const gsm: {
  codec: 'gsm'
  decode(bytes: Uint8Array | ArrayBuffer): Promise<{ channelData: Float32Array[], sampleRate: number }>
}

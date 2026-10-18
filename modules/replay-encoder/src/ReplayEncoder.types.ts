export interface EncoderConfigInput {
  /** Output .mp4 file, `file://` URI or absolute path. An existing file is replaced; missing parent directories are created. */
  path: string;
  /** Pixels. Even, 16..4096. */
  width: number;
  /** Pixels. Even, 16..4096. */
  height: number;
  /** Integer, 1..60. */
  fps: number;
  /** Bits per second, clamped to 1..20 Mbps. Default: width * height * fps * 0.11 (1080x1920 at 30 fps is 6.84 Mbps). */
  bitrate?: number;
}

export interface EncoderSession {
  id: string;
  width: number;
  height: number;
  fps: number;
  /** The bitrate in use after the default and the clamp were applied. */
  bitrate: number;
  /** The output path exactly as `begin` received it. */
  path: string;
}

export interface EncoderResult {
  /** `file://` URI of the finished MP4. */
  uri: string;
  bytes: number;
  frames: number;
  durationMs: number;
}

export interface EncoderSupport {
  /** An H.264 encoder that takes ByteBuffer/CPU frames exists (always true on iOS 16.4+). */
  available: boolean;
  h264: boolean;
  /** Largest frame size the best H.264 encoder reports (iOS: 4096). */
  maxWidth: number;
  maxHeight: number;
}

/** `code` of every rejection of the module functions. */
export type EncoderErrorCode =
  | 'ERR_ENCODER_UNSUPPORTED'
  | 'ERR_ENCODER_CONFIG'
  | 'ERR_ENCODER_FRAME'
  | 'ERR_ENCODER_STATE'
  | 'ERR_ENCODER_IO';

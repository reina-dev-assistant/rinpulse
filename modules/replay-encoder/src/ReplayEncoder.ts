import { NativeModule, requireNativeModule } from 'expo';
import type { EncoderConfigInput, EncoderResult, EncoderSession, EncoderSupport } from './ReplayEncoder.types';

/**
 * Streams rendered frames into an H.264 MP4. Every function rejects with an error whose `code` is one of `EncoderErrorCode`
 * (ReplayEncoder.types.ts): ERR_ENCODER_UNSUPPORTED (no usable encoder or frame size), ERR_ENCODER_CONFIG (bad `begin` input),
 * ERR_ENCODER_FRAME (index gap or repeat, unreadable or undecodable frame file, `.raw` on iOS), ERR_ENCODER_STATE (unknown or
 * finished id, a session is already active, cancelled), ERR_ENCODER_IO (file or codec failure).
 *
 * After any rejection other than ERR_ENCODER_FRAME the session is already torn down natively and its partial file deleted; a bad
 * frame leaves the session usable, so the caller may retry the same index.
 */
declare class ReplayEncoderModule extends NativeModule {
  /** Whether this device can encode and the largest frame size it accepts. Never rejects. */
  getSupport(): Promise<EncoderSupport>;

  /** Opens the output file and the encoder. One session at a time; a second `begin` rejects with ERR_ENCODER_STATE until `finish` or `cancel`. */
  begin(config: EncoderConfigInput): Promise<EncoderSession>;

  /**
   * Hands one frame to the encoder. `frameUri` is a `file://` URI or absolute path of a PNG, JPEG or WEBP (any size: it is scaled to
   * fill width x height, the overflow is cropped), or on Android the react-native-view-shot `.raw` file (header `<w>:<h>|` then w*h*4 bytes
   * RGBA, no PNG round trip). The file stays yours; it is never deleted. `index` starts at 0 and grows by exactly 1; the presentation time
   * is index * 1_000_000 / fps microseconds. Resolves once the encoder has taken the frame, so awaiting each call is the back-pressure.
   */
  appendFrame(id: string, frameUri: string, index: number): Promise<void>;

  /** Drains the encoder, writes the MP4 trailer and returns the file. Needs at least one frame. */
  finish(id: string): Promise<EncoderResult>;

  /** Stops everything and deletes the partial file. Idempotent; an `appendFrame` in flight rejects with ERR_ENCODER_STATE. */
  cancel(id: string): Promise<void>;
}

export default requireNativeModule<ReplayEncoderModule>('ReplayEncoder');

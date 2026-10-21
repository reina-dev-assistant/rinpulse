/**
 * The watch's quick replies (the list under a notification's reply button). Native code: `QuickReplies.kt` (module
 * `hw.unitedevice.smsquick`, ExpandCapability 82); protocol/README.md, section "Quick replies".
 */
export interface QuickRepliesStatus {
  /** A connected watch sets ExpandCapability 82 and lists the P2P service. False while no watch is connected and on iOS. */
  supported: boolean;
  /** How many replies the watch holds (Gadgetbridge's slot count; 0 on iOS). */
  slots: number;
  /** The longest reply in characters, a phone-side limit (the watch reports none; 0 on iOS). */
  maxLength: number;
}

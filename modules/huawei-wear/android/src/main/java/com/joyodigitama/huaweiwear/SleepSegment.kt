// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider.fetchActivityData.
package com.joyodigitama.huaweiwear

/**
 * One sleep span. `type` is GB's raw sample kind (frame sleep: the watch's state byte; TruSleep and
 * dictionary sleep: 0x06 light, 0x07 deep, 0x5656 REM, 0x5658 awake, 0x5659 nap, 1 unknown; and
 * [EstimatedSleepStages.RAW_ESTIMATED] for a row the phone's own estimate produced).
 * `stage` is GB's `normalizeType` of it as 'light' | 'deep' | 'rem' | 'awake', null when GB has none.
 * [breakBefore] is only ever set by [SleepCleaning.cleanUnstagedSleep] (never stored): a workout or a long awake stretch
 * lies between this span and the one before it, so it starts a new sleep session however close the two are.
 */
internal class SleepSegment(
  val start: Long,
  val end: Long,
  val type: Int,
  val stage: String?,
  val breakBefore: Boolean = false,
) {
  fun toJs(): Map<String, Any?> = mapOf("start" to start, "end" to end, "type" to type, "stage" to stage)
}

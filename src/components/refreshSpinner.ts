/**
 * Where the pull-to-refresh spinner sits: below the status bar and the notch on a screen whose scroll view starts at
 * the top edge of the display (tab roots that draw their own title), at the scroll view's own top otherwise. Without
 * the offset iOS draws the spinner at y = 0 of that scroll view, which the notch covers.
 */
export function refreshSpinnerOffset(underStatusBar: boolean, topInset: number): number {
  return underStatusBar ? topInset : 0;
}

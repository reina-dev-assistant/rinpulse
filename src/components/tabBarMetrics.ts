/**
 * Height budget of the bottom tab bar, in dp.
 *
 * The navigator's default is 49 plus the bottom inset, which is enough for its 10 px label. Ours is 12 px Plus Jakarta Sans
 * (a 1.26 line), and the system font size makes it larger still, so the label ran past the content area into the inset
 * area, where the 3-button bar or the gesture pill sits: "Hari ini" showed half. The bar is sized from what is drawn instead:
 * item padding, icon box, label line, padding, and the inset below all of it.
 */

/** BottomTabItem draws the icon and label inside a button with 5 dp of padding on every side. */
export const TAB_ITEM_PADDING = 5;
/** TabBarIcon's box for a 25 dp glyph. */
export const TAB_ICON_BOX = 28;
export const TAB_LABEL_SIZE = 12;
/** Fixed, so the budget does not depend on the font's own metrics (Plus Jakarta Sans is 1.26 em tall). */
export const TAB_LABEL_LINE = 16;
/** Above this the five labels no longer fit a phone's width; the tab bar stays readable rather than growing with the setting. */
export const TAB_LABEL_MAX_SCALE = 1.3;
/** How far a label may shrink so a long one ("Pengaturan") stays whole on a narrow screen instead of ending in an ellipsis. */
export const TAB_LABEL_MIN_SHRINK = 0.7;

/** The scale the label is drawn at, and so the one the bar is sized for: the system's, within [1, max]. */
export function tabLabelScale(fontScale: number): number {
  if (!Number.isFinite(fontScale)) return 1;
  return Math.min(Math.max(fontScale, 1), TAB_LABEL_MAX_SCALE);
}

/** Height of the area above the inset: padding, icon box, label line, padding. */
export function tabBarContentHeight(fontScale: number): number {
  return Math.ceil(TAB_ITEM_PADDING * 2 + TAB_ICON_BOX + TAB_LABEL_LINE * tabLabelScale(fontScale));
}

/**
 * The tab bar's total height. The navigator draws the bar this tall and pads its bottom by `bottomInset`
 * (gesture area, 3-button bar, iOS home indicator), so the content area keeps its own height whatever the inset.
 */
export function tabBarHeight(fontScale: number, bottomInset: number): number {
  return tabBarContentHeight(fontScale) + Math.max(0, Number.isFinite(bottomInset) ? bottomInset : 0);
}

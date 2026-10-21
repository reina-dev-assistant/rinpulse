/**
 * Size budget of the floating bottom tab bar, in dp.
 *
 * The bar is a solid rounded pill inset from the screen edges and lifted above the bottom inset (gesture area, 3-button bar, iOS
 * home indicator). It floats over the screens (absolute): content scrolls underneath, and each scrolling screen pads the end of its
 * content by what the bar covers (`tabBarInset`). The centre button (start a workout) is raised out of the pill by `CENTER_RAISE`
 * and counts toward that footprint. The pill is sized from what is drawn: item padding, icon box,
 * label line, the pill's own padding and border. The label is 12 px Plus Jakarta Sans (a 1.26 line) and the system font size makes
 * it larger still, so the label line is fixed and scaled with the system setting up to a cap.
 */

/** Padding of an item's content inside the item (icon and label sit in a button with this on every side). */
export const TAB_ITEM_PADDING = 5;
/** Box for a 25 dp glyph. */
export const TAB_ICON_BOX = 28;
export const TAB_LABEL_SIZE = 12;
/** Fixed, so the budget does not depend on the font's own metrics (Plus Jakarta Sans is 1.26 em tall). */
export const TAB_LABEL_LINE = 16;
/** Above this the four labels no longer fit a phone's width; the tab bar stays readable rather than growing with the setting. */
export const TAB_LABEL_MAX_SCALE = 1.3;
/** How far a label may shrink so a long one ("Pengaturan") stays whole on a narrow screen instead of ending in an ellipsis. */
export const TAB_LABEL_MIN_SHRINK = 0.7;

/** Space between the pill's border and the items. */
export const TAB_BAR_PADDING = 6;
/** The pill's hairline border. */
export const TAB_BAR_BORDER = 1;
/** Gap between the pill and each side of the screen. */
export const TAB_BAR_MARGIN_X = 16;
/** Centre button: a filled circle (the 56 dp primary target) inside a ring in the pill's colour that notches the pill. */
export const CENTER_SIZE = 56;
export const CENTER_RING = 4;
export const CENTER_OUTER = CENTER_SIZE + CENTER_RING * 2;
/** How far the centre button rises above the pill's top edge; it is also the strip's space above the pill, so the raised half stays inside the strip's touchable bounds on Android. */
export const CENTER_RAISE = 20;
/** Width the centre slot reserves in the pill for the button, with breathing room either side. */
export const CENTER_SLOT = CENTER_OUTER + 8;
/** Gap between the pill and the bottom inset (Android), and the least distance from the screen's bottom edge on iOS. */
export const TAB_BAR_GAP_BOTTOM = 8;
/** iOS: how far the pill dips into the home indicator's safe area; the indicator is a thin line, so the full inset leaves an empty band. */
export const TAB_BAR_IOS_INSET_TUCK = 12;

/** The scale the label is drawn at, and so the one the bar is sized for: the system's, within [1, max]. */
export function tabLabelScale(fontScale: number): number {
  if (!Number.isFinite(fontScale)) return 1;
  return Math.min(Math.max(fontScale, 1), TAB_LABEL_MAX_SCALE);
}

/** Height of one item: padding, icon box, label line, padding. */
export function tabBarContentHeight(fontScale: number): number {
  return Math.ceil(TAB_ITEM_PADDING * 2 + TAB_ICON_BOX + TAB_LABEL_LINE * tabLabelScale(fontScale));
}

/** Height of the pill itself: its border and padding around one item. */
export function tabBarPillHeight(fontScale: number): number {
  return tabBarContentHeight(fontScale) + (TAB_BAR_PADDING + TAB_BAR_BORDER) * 2;
}

function safeInset(bottomInset: number): number {
  return Math.max(0, Number.isFinite(bottomInset) ? bottomInset : 0);
}

/**
 * Distance from the screen's bottom edge to the pill. Android: the inset plus the gap. iOS: the inset minus a tuck so the pill
 * sits close to the home indicator, never nearer the edge than the gap (devices without a home indicator).
 */
export function tabBarBottomOffset(bottomInset: number, os: string): number {
  const inset = safeInset(bottomInset);
  if (os === 'ios') return Math.max(inset - TAB_BAR_IOS_INSET_TUCK, TAB_BAR_GAP_BOTTOM);
  return inset + TAB_BAR_GAP_BOTTOM;
}

/**
 * Total height the bar takes from the screen: the centre button's rise above the pill, the pill, and the offset below it.
 * Overlays that sit above the bar (snackbar, toast) use this as their bottom offset.
 */
export function floatingTabBarFootprint(fontScale: number, bottomInset: number, os: string): number {
  return CENTER_RAISE + tabBarPillHeight(fontScale) + tabBarBottomOffset(bottomInset, os);
}

/** The theme's bar radius, never more than half the pill's height (999 means a full pill), never negative. */
export function tabBarRadius(themeRadius: number, pillHeight: number): number {
  const half = pillHeight / 2;
  if (!Number.isFinite(themeRadius)) return half;
  return Math.min(Math.max(themeRadius, 0), half);
}

/** Radius of an item's active background: concentric with the pill (bar radius minus the padding and border between them). */
export function tabItemRadius(barRadius: number, itemHeight: number): number {
  return Math.min(Math.max(barRadius - TAB_BAR_PADDING - TAB_BAR_BORDER, 0), itemHeight / 2);
}

import { describe, expect, it } from 'bun:test';

import {
  floatingTabBarFootprint,
  TAB_BAR_BORDER,
  TAB_BAR_GAP_BOTTOM,
  TAB_BAR_GAP_TOP,
  TAB_BAR_PADDING,
  TAB_ICON_BOX,
  TAB_ITEM_PADDING,
  TAB_LABEL_LINE,
  TAB_LABEL_MAX_SCALE,
  tabBarContentHeight,
  tabBarPillHeight,
  tabBarRadius,
  tabItemRadius,
  tabLabelScale,
} from './tabBarMetrics';

describe('tabLabelScale', () => {
  it('follows the system font size between 1 and the cap', () => {
    expect(tabLabelScale(1)).toBe(1);
    expect(tabLabelScale(1.15)).toBe(1.15);
    expect(tabLabelScale(1.3)).toBe(1.3);
  });
  it('stops at the cap for the largest settings', () => {
    expect(tabLabelScale(2)).toBe(TAB_LABEL_MAX_SCALE);
    expect(tabLabelScale(3.5)).toBe(TAB_LABEL_MAX_SCALE);
  });
  it('does not shrink the budget for a small font setting', () => {
    expect(tabLabelScale(0.85)).toBe(1);
  });
  it('falls back to 1 for a value that is not a number', () => {
    expect(tabLabelScale(Number.NaN)).toBe(1);
    expect(tabLabelScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('tabBarContentHeight', () => {
  it('holds the padding, icon box and label line at the default font size', () => {
    expect(tabBarContentHeight(1)).toBe(TAB_ITEM_PADDING * 2 + TAB_ICON_BOX + TAB_LABEL_LINE);
  });
  it('is taller than the navigator default of 49, which cut the labels', () => {
    expect(tabBarContentHeight(1)).toBeGreaterThan(49);
  });
  it('always has room for the label at the scale it is drawn at', () => {
    for (const fontScale of [0.8, 1, 1.1, 1.15, 1.3, 1.5, 2]) {
      const labelLine = TAB_LABEL_LINE * tabLabelScale(fontScale);
      expect(tabBarContentHeight(fontScale)).toBeGreaterThanOrEqual(TAB_ITEM_PADDING * 2 + TAB_ICON_BOX + labelLine);
    }
  });
  it('grows with the font size and stops at the cap', () => {
    expect(tabBarContentHeight(1.3)).toBeGreaterThan(tabBarContentHeight(1));
    expect(tabBarContentHeight(2)).toBe(tabBarContentHeight(TAB_LABEL_MAX_SCALE));
  });
  it('is a whole number of dp', () => {
    expect(Number.isInteger(tabBarContentHeight(1.15))).toBe(true);
  });
});

describe('tabBarPillHeight', () => {
  it('wraps one item in the pill padding and border', () => {
    expect(tabBarPillHeight(1)).toBe(tabBarContentHeight(1) + (TAB_BAR_PADDING + TAB_BAR_BORDER) * 2);
  });
  it('grows with the font size and stops at the cap', () => {
    expect(tabBarPillHeight(1.3)).toBeGreaterThan(tabBarPillHeight(1));
    expect(tabBarPillHeight(3)).toBe(tabBarPillHeight(TAB_LABEL_MAX_SCALE));
  });
});

describe('floatingTabBarFootprint', () => {
  it('is the gaps and the pill where there is no inset', () => {
    expect(floatingTabBarFootprint(1, 0)).toBe(TAB_BAR_GAP_TOP + tabBarPillHeight(1) + TAB_BAR_GAP_BOTTOM);
  });
  it('keeps the pill and gaps the same for every kind of navigation', () => {
    const gesture = 16;
    const threeButton = 48;
    const iosHomeIndicator = 34;
    for (const inset of [gesture, threeButton, iosHomeIndicator]) {
      expect(floatingTabBarFootprint(1.15, inset) - inset).toBe(floatingTabBarFootprint(1.15, 0));
    }
  });
  it('adds a fractional inset as it is', () => {
    expect(floatingTabBarFootprint(1, 24.5)).toBe(floatingTabBarFootprint(1, 0) + 24.5);
  });
  it('ignores a negative or missing inset', () => {
    expect(floatingTabBarFootprint(1, -4)).toBe(floatingTabBarFootprint(1, 0));
    expect(floatingTabBarFootprint(1, Number.NaN)).toBe(floatingTabBarFootprint(1, 0));
  });
});

describe('tabBarRadius', () => {
  it('keeps a small theme radius as it is', () => {
    expect(tabBarRadius(14, 64)).toBe(14);
  });
  it('turns 999 into a full pill (half the height)', () => {
    expect(tabBarRadius(999, 64)).toBe(32);
  });
  it('never goes negative or non-finite', () => {
    expect(tabBarRadius(-5, 64)).toBe(0);
    expect(tabBarRadius(Number.NaN, 64)).toBe(32);
  });
});

describe('tabItemRadius', () => {
  it('is concentric: the bar radius minus the padding and border', () => {
    expect(tabItemRadius(20, 50)).toBe(20 - TAB_BAR_PADDING - TAB_BAR_BORDER);
  });
  it('is a full pill inside a full pill', () => {
    const pill = tabBarPillHeight(1);
    const item = tabBarContentHeight(1);
    expect(tabItemRadius(tabBarRadius(999, pill), item)).toBe(item / 2);
  });
  it('does not go below zero for a squarish bar', () => {
    expect(tabItemRadius(4, 50)).toBe(0);
  });
});

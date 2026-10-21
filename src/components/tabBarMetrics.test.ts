import { describe, expect, it } from 'bun:test';

import {
  CENTER_OUTER,
  CENTER_RAISE,
  CENTER_RING,
  CENTER_SIZE,
  CENTER_SLOT,
  floatingTabBarFootprint,
  tabBarBottomOffset,
  TAB_BAR_BORDER,
  TAB_BAR_GAP_BOTTOM,
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

describe('tabBarBottomOffset', () => {
  it('tucks the pill toward the iOS home indicator', () => {
    expect(tabBarBottomOffset(34, 'ios')).toBe(22);
    expect(tabBarBottomOffset(20, 'ios')).toBe(TAB_BAR_GAP_BOTTOM);
  });
  it('is the inset plus the gap on Android', () => {
    expect(tabBarBottomOffset(16, 'android')).toBe(16 + TAB_BAR_GAP_BOTTOM);
    expect(tabBarBottomOffset(48, 'android')).toBe(48 + TAB_BAR_GAP_BOTTOM);
  });
  it('is the minimum gap without an inset', () => {
    expect(tabBarBottomOffset(0, 'ios')).toBe(TAB_BAR_GAP_BOTTOM);
    expect(tabBarBottomOffset(0, 'android')).toBe(TAB_BAR_GAP_BOTTOM);
  });
  it('ignores a negative or missing inset', () => {
    expect(tabBarBottomOffset(-4, 'ios')).toBe(TAB_BAR_GAP_BOTTOM);
    expect(tabBarBottomOffset(Number.NaN, 'android')).toBe(TAB_BAR_GAP_BOTTOM);
  });
});

describe('floatingTabBarFootprint', () => {
  const strip = CENTER_RAISE + tabBarPillHeight(1);
  it('is the centre button rise, the pill and the gap where there is no inset', () => {
    expect(floatingTabBarFootprint(1, 0, 'android')).toBe(strip + TAB_BAR_GAP_BOTTOM);
    expect(floatingTabBarFootprint(1, 0, 'ios')).toBe(strip + TAB_BAR_GAP_BOTTOM);
  });
  it('uses the same offset the bar is placed at', () => {
    expect(floatingTabBarFootprint(1, 34, 'ios')).toBe(strip + 22);
    expect(floatingTabBarFootprint(1, 34, 'android')).toBe(strip + 34 + TAB_BAR_GAP_BOTTOM);
    expect(floatingTabBarFootprint(1, 24.5, 'android')).toBe(strip + 24.5 + TAB_BAR_GAP_BOTTOM);
  });
});

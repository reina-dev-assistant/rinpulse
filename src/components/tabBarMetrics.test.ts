import { describe, expect, it } from 'bun:test';

import {
  TAB_ICON_BOX,
  TAB_ITEM_PADDING,
  TAB_LABEL_LINE,
  TAB_LABEL_MAX_SCALE,
  tabBarContentHeight,
  tabBarHeight,
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

describe('tabBarHeight', () => {
  it('is the content with nothing below it where there is no inset', () => {
    expect(tabBarHeight(1, 0)).toBe(tabBarContentHeight(1));
  });
  it('keeps the content area the same for every kind of navigation', () => {
    const gesture = 16;
    const threeButton = 48;
    const iosHomeIndicator = 34;
    for (const inset of [gesture, threeButton, iosHomeIndicator]) {
      expect(tabBarHeight(1.15, inset) - inset).toBe(tabBarContentHeight(1.15));
    }
  });
  it('adds a fractional inset as it is', () => {
    expect(tabBarHeight(1, 24.5)).toBe(tabBarContentHeight(1) + 24.5);
  });
  it('ignores a negative or missing inset', () => {
    expect(tabBarHeight(1, -4)).toBe(tabBarContentHeight(1));
    expect(tabBarHeight(1, Number.NaN)).toBe(tabBarContentHeight(1));
  });
});

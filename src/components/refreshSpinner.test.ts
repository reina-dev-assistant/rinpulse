import { describe, expect, it } from 'bun:test';

import { refreshSpinnerOffset } from './refreshSpinner';

describe('refreshSpinnerOffset', () => {
  it('drops the spinner below the notch on a tab root that scrolls from the top edge of the display', () => {
    expect(refreshSpinnerOffset(true, 47)).toBe(47);
  });

  it('leaves it alone on a stack screen whose native header already clears the status bar', () => {
    expect(refreshSpinnerOffset(false, 47)).toBe(0);
  });
});

import { createContext, useContext } from 'react';

/** Gap kept between a revealed input and the keyboard's top edge. */
export const REVEAL_MARGIN = 24;

/**
 * How far a scroll view must scroll down so an input ending at `inputBottom` (window y) clears the keyboard whose top edge is
 * at `keyboardTop`. Zero when it is already clear; never negative, since the input is what the user is typing into and moving
 * it up is the only direction the keyboard forces.
 */
export function revealDelta(inputBottom: number, keyboardTop: number, margin = REVEAL_MARGIN): number {
  return Math.max(0, Math.round(inputBottom + margin - keyboardTop));
}

/** Provided by `Screen`: scrolls the focused input above the keyboard. A no-op outside a keyboard-aware screen. */
export const KeyboardRevealContext = createContext<() => void>(() => {});

export function useRevealFocusedInput() {
  return useContext(KeyboardRevealContext);
}

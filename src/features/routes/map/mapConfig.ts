/** What every route map shares. Pure data. */

/** OpenFreeMap vector tiles (https://openfreemap.org). Never tile.openstreetmap.org: its policy forbids app use. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** The map is light in every JoyoFit theme, so what sits on it uses fixed colors, not the theme's. */
export const MAP_INK = {
  casing: '#FFFFFF',
  chipBackground: 'rgba(255,255,255,0.85)',
  chipText: '#2B2B2B',
  /** The dark outline of a line that must stand out on the light map (the loop planner's route). */
  outline: '#12263F',
} as const;

/** Where the drawing map opens when nothing says where the user is: all of Indonesia. */
export const DEFAULT_CAMERA = { lat: -2.5, lon: 118, zoom: 3.8 } as const;

/** Zoom for a position the app knows (the user's own, the weather city, a searched place). */
export const PLACE_ZOOM = 14;

/** Padding of the fitted route box, in dp. */
export const FIT_PADDING = { top: 32, right: 32, bottom: 32, left: 32 } as const;

export const LINE_WIDTH = 4;
export const CASING_WIDTH = 7;

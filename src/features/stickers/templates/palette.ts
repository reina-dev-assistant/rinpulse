/**
 * Colors of the built-in stickers. They are the sticker's own brand, not the app theme: a sticker looks the same whichever
 * of Classic, Sport or Ocean the person runs, and `dark` / `light` is the picker's choice (default: the phone's scheme).
 *
 * - INK: JoyoFit's teal ink with the amber accent of the Classic hero; warm paper by day. The default family.
 * - VOLT: black with the Sport theme's volt; by day the whole card is volt with black type (the loud one, numbers first).
 * - PAPER: editorial. Cream stock with teal ink by day, teal stock with cream and amber by night. Poster and receipt.
 * - NIGHT: sleep. Deep indigo ink with the app's stage colors; lavender paper by day.
 * - GLASS: for photos. White type with a shadow by night; ink type on a milky panel by day.
 * - STICKER: transparent canvases: only text and marks, so the colors must hold on any photo.
 * Data colors (heart rate zones, sleep stages, heat) are carried by the data builders, not by tokens.
 */
import type { ThemeColors } from './dsl';

export interface Palette {
  dark: ThemeColors;
  light: ThemeColors;
}

export const INK: Palette = {
  dark: {
    bg: '#0b1b21',
    bg2: '#123340',
    fg: '#f2f7f8',
    fgSoft: '#f2f7f8e0',
    fgMuted: '#a9c2c9',
    accent: '#f5b35a',
    accent2: '#5fd3ee',
    surface: '#ffffff12',
    surfaceStrong: '#ffffff24',
    line: '#f2f7f824',
    good: '#6ee7a0',
    warn: '#f5b35a',
    bad: '#ff8fa4',
  },
  light: {
    bg: '#f9f6f1',
    bg2: '#efe8dc',
    fg: '#0f2f3a',
    fgSoft: '#0f2f3ad9',
    fgMuted: '#5b6f76',
    accent: '#b45f00',
    accent2: '#0a6580',
    surface: '#0f2f3a0d',
    surfaceStrong: '#0f2f3a1a',
    line: '#0f2f3a1f',
    good: '#177a45',
    warn: '#b45309',
    bad: '#b42318',
  },
};

export const VOLT: Palette = {
  dark: {
    bg: '#0b0b0c',
    bg2: '#17171a',
    fg: '#ffffff',
    fgSoft: '#ffffffe0',
    fgMuted: '#a3a3ad',
    accent: '#d4ff3a',
    accent2: '#ff8a1f',
    surface: '#ffffff14',
    surfaceStrong: '#ffffff29',
    line: '#ffffff29',
    good: '#2ee59d',
    warn: '#ffa040',
    bad: '#ff4d6a',
  },
  light: {
    bg: '#d4ff3a',
    bg2: '#c2f01c',
    fg: '#0b0b0c',
    fgSoft: '#0b0b0cd9',
    fgMuted: '#0b0b0c99',
    accent: '#0b0b0c',
    accent2: '#2c3a00',
    surface: '#0b0b0c14',
    surfaceStrong: '#0b0b0c26',
    line: '#0b0b0c33',
    good: '#0b5f34',
    warn: '#7a4300',
    bad: '#a3121f',
  },
};

export const PAPER: Palette = {
  dark: {
    bg: '#0f2f3a',
    bg2: '#0b242d',
    fg: '#f4efe4',
    fgSoft: '#f4efe4e0',
    fgMuted: '#9db4ba',
    accent: '#f5b35a',
    accent2: '#5fd3ee',
    surface: '#f4efe414',
    surfaceStrong: '#f4efe426',
    line: '#f4efe42e',
    good: '#6ee7a0',
    warn: '#f5b35a',
    bad: '#ff8fa4',
  },
  light: {
    bg: '#f4efe4',
    bg2: '#e9e2d3',
    fg: '#1d1a15',
    fgSoft: '#1d1a15d9',
    fgMuted: '#6b665b',
    accent: '#0f2f3a',
    accent2: '#c2700a',
    surface: '#1d1a150d',
    surfaceStrong: '#1d1a151a',
    line: '#1d1a1533',
    good: '#177a45',
    warn: '#b45309',
    bad: '#b42318',
  },
};

export const NIGHT: Palette = {
  dark: {
    bg: '#0c0f24',
    bg2: '#1a1f4a',
    fg: '#eef0ff',
    fgSoft: '#eef0ffe0',
    fgMuted: '#9aa3dc',
    accent: '#8f9be3',
    accent2: '#c09cf5',
    surface: '#ffffff12',
    surfaceStrong: '#ffffff24',
    line: '#eef0ff26',
    good: '#6ee7a0',
    warn: '#f0a23c',
    bad: '#ff8fa4',
  },
  light: {
    bg: '#eef0ff',
    bg2: '#dde1fb',
    fg: '#1c2154',
    fgSoft: '#1c2154d9',
    fgMuted: '#59608f',
    accent: '#424b8e',
    accent2: '#7d54c9',
    surface: '#1c21540d',
    surfaceStrong: '#1c21541a',
    line: '#1c215424',
    good: '#177a45',
    warn: '#b45309',
    bad: '#b42318',
  },
};

/** Over a photo: type is white with a shadow by night, ink on a milky panel by day. */
export const GLASS: Palette = {
  dark: {
    bg: '#000000',
    bg2: '#000000',
    fg: '#ffffff',
    fgSoft: '#ffffffeb',
    fgMuted: '#ffffffb8',
    accent: '#f5b35a',
    accent2: '#5fd3ee',
    surface: '#ffffff1f',
    surfaceStrong: '#ffffff38',
    line: '#ffffff40',
    good: '#6ee7a0',
    warn: '#f5b35a',
    bad: '#ff8fa4',
  },
  light: {
    bg: '#ffffff',
    bg2: '#ffffff',
    fg: '#0f2f3a',
    fgSoft: '#0f2f3ae6',
    fgMuted: '#0f2f3a99',
    accent: '#b45f00',
    accent2: '#0a6580',
    surface: '#ffffffb3',
    surfaceStrong: '#ffffffd9',
    line: '#0f2f3a2e',
    good: '#177a45',
    warn: '#b45309',
    bad: '#b42318',
  },
};

/** Transparent stickers: light-on-dark photos by night, ink-on-light photos by day. Accents stay readable on both. */
export const STICKER: Palette = {
  dark: {
    bg: '#000000',
    bg2: '#000000',
    fg: '#ffffff',
    fgSoft: '#ffffffeb',
    fgMuted: '#ffffffc2',
    accent: '#f5b35a',
    accent2: '#5fd3ee',
    surface: '#0000004d',
    surfaceStrong: '#00000073',
    line: '#ffffff59',
    good: '#6ee7a0',
    warn: '#f5b35a',
    bad: '#ff8fa4',
  },
  light: {
    bg: '#ffffff',
    bg2: '#ffffff',
    fg: '#0b1b21',
    fgSoft: '#0b1b21e6',
    fgMuted: '#0b1b21a3',
    accent: '#b45f00',
    accent2: '#0a6580',
    surface: '#ffffff99',
    surfaceStrong: '#ffffffcc',
    line: '#0b1b2140',
    good: '#177a45',
    warn: '#b45309',
    bad: '#b42318',
  },
};

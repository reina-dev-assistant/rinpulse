/**
 * JoyoFit themes. Pure data, no React Native imports, so the contrast test can run under bun.
 *
 * A theme is a palette pair (light and dark), radii, a font pair and a type scale for the big numerals.
 * Components never read a theme directly: they go through `useTheme()` / `useColors()` in `./index`.
 *
 * - Classic: the original look. Warm paper canvas, ink-teal primary, Plus Jakarta Sans, large radii.
 *   Light and dark follow the phone. Same family as JoyoRogo design v2: one primary plus data colors
 *   that only tell metrics apart, each with a soft tint (chip and tile background) and a darker
 *   `*Text` shade that passes AA on that tint. Sleep stays indigo, the same as JoyoRogo's "tidur".
 *   The watch hero is an ink "screen" panel in both palettes, so the live numbers read like a watch face.
 * - Sport: Nike Run Club / Strava feel. Always dark, near-black canvas, one volt accent, tight radii,
 *   square-ish controls, Bebas Neue numerals.
 * - Ocean: cool blue-grey canvas and a blue primary, Space Grotesk numerals. Light and dark follow the phone.
 * - AMOLED: pure black canvas (the pixels are off), white primary, Manrope. Always dark.
 * - Neon: night-run. Near-black, hot pink primary, cyan steps, JetBrains Mono numerals. Always dark.
 * - Sunset: dusk plum canvas, orange primary, the watch hero panel is a plum-to-ember gradient. Always dark.
 * - Sogan: batik sogan earth tones (brown, indigo, gold), Fraunces titles. Light and dark follow the phone.
 * - Retro: cream paper and orange, Archivo Black numerals, chunky radii. Always light.
 * - Forest: moss green and bark, Fraunces titles, Archivo numerals. Light and dark follow the phone.
 * - Soft: pastel blush, rounded Nunito, very large radii. Light and dark follow the phone.
 * - Mono: black and white, square corners, JetBrains Mono numerals; only the heart is red. Light and dark follow the phone.
 *
 * Contrast (enforced in `themes.test.ts` for every palette of every theme): every `*Text` on its
 * `*Soft` and on `card` is >= 4.5; base data colors on `card` are >= 3 (non-text 3:1); `mutedForeground`
 * is >= 4.5 on background, card and muted; hero text is >= 4.5 on `hero` and on `heroEnd` (the gradient's
 * other end; equal to `hero` for a flat panel).
 *
 * Fonts: every family name here is a font registered at runtime (`./fonts.ts`, expo-font `loadAsync`, files in
 * `assets/fonts`), never by the config plugin, so adding or changing a font stays an OTA update.
 * Android has no weight axis, so each weight is its own family.
 */

export type Tint = 'steps' | 'heart' | 'sleep' | 'workouts' | 'link';

export interface Colors {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  hairline: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  destructiveSoft: string;
  warning: string;
  switchOff: string;
  steps: string;
  stepsSoft: string;
  stepsText: string;
  heart: string;
  heartSoft: string;
  heartText: string;
  sleep: string;
  sleepSoft: string;
  sleepText: string;
  workouts: string;
  workoutsSoft: string;
  workoutsText: string;
  link: string;
  linkSoft: string;
  linkText: string;
  stageDeep: string;
  stageRem: string;
  stageLight: string;
  stageAwake: string;
  hero: string;
  /** The hero panel's other gradient stop (top-left `hero` to bottom-right `heroEnd`); equal to `hero` when the panel is flat. */
  heroEnd: string;
  heroForeground: string;
  heroMuted: string;
  heroTrack: string;
  heroDivider: string;
  heroSteps: string;
  heroHeart: string;
  heroLink: string;
  heroWarn: string;
  /** Route line and highlight on the hero panel and the share card. */
  heroAccent: string;
}

export type Scheme = 'light' | 'dark';

export interface Radii {
  /** Cards, sheets, dialogs. */
  card: number;
  /** Stat tiles, route and photo frames. */
  tile: number;
  input: number;
  /** Buttons, chips and the segmented control. Pill-shaped (999) or squarer. */
  control: number;
  /** The floating tab bar; it is clamped to half its height, so 999 is a full pill. */
  bar: number;
}

/** One size of a big number: the number itself and the small unit that follows it. */
export interface NumeralStyle {
  size: number;
  line: number;
  tracking: number;
  unit: number;
}

/** Every font family the app can register; `fonts.ts` maps each to its file. The union keeps that map complete. */
export const FONT_FAMILY_NAMES = [
  'PlusJakartaSans_500Medium',
  'PlusJakartaSans_600SemiBold',
  'PlusJakartaSans_700Bold',
  'PlusJakartaSans_800ExtraBold',
  'Manrope_500Medium',
  'Manrope_600SemiBold',
  'Manrope_700Bold',
  'Manrope_800ExtraBold',
  'Nunito_500Medium',
  'Nunito_600SemiBold',
  'Nunito_700Bold',
  'Nunito_800ExtraBold',
  'Archivo_500Medium',
  'Archivo_600SemiBold',
  'Archivo_700Bold',
  'Archivo_800ExtraBold',
  'Archivo_900Black',
  'BebasNeue_400Regular',
  'SpaceGrotesk_500Medium',
  'SpaceGrotesk_600SemiBold',
  'SpaceGrotesk_700Bold',
  'JetBrainsMono_800ExtraBold',
  'Fraunces_800ExtraBold',
] as const;

export type FontFamilyName = (typeof FONT_FAMILY_NAMES)[number];

/**
 * The font pair of a theme. `regular` to `heavy` are the body weights (text, labels, buttons); `numeral` is the face of the
 * big numbers (it must have tabular figures, they sit in live timers) and `headline` the face of page titles.
 */
export interface FontFamilies {
  regular: FontFamilyName;
  medium: FontFamilyName;
  bold: FontFamilyName;
  heavy: FontFamilyName;
  numeral: FontFamilyName;
  headline: FontFamilyName;
}

export interface Typography {
  fonts: FontFamilies;
  /** The metric numeral scale: Today hero, tile figures, section figures, inline figures. */
  numeral: { hero: NumeralStyle; lg: NumeralStyle; md: NumeralStyle; sm: NumeralStyle };
  /** Page titles. */
  title: { size: number; line: number; tracking: number };
}

export type ThemeId =
  | 'classic'
  | 'sport'
  | 'ocean'
  | 'amoled'
  | 'neon'
  | 'sunset'
  | 'sogan'
  | 'retro'
  | 'forest'
  | 'soft'
  | 'mono';

export interface Theme {
  id: ThemeId;
  // Display name and tagline are translated at render: `common:theme.<id>.name` and `.tagline`.
  /** `system` follows the phone's light/dark setting; the others pin it. */
  appearance: 'system' | Scheme;
  palettes: { light: Colors; dark: Colors };
  radius: Radii;
  type: Typography;
}

const JAKARTA = {
  w500: 'PlusJakartaSans_500Medium',
  w600: 'PlusJakartaSans_600SemiBold',
  w700: 'PlusJakartaSans_700Bold',
  w800: 'PlusJakartaSans_800ExtraBold',
} as const;

const MANROPE = {
  w500: 'Manrope_500Medium',
  w600: 'Manrope_600SemiBold',
  w700: 'Manrope_700Bold',
  w800: 'Manrope_800ExtraBold',
} as const;

const NUNITO = {
  w500: 'Nunito_500Medium',
  w600: 'Nunito_600SemiBold',
  w700: 'Nunito_700Bold',
  w800: 'Nunito_800ExtraBold',
} as const;

const ARCHIVO = {
  w500: 'Archivo_500Medium',
  w600: 'Archivo_600SemiBold',
  w700: 'Archivo_700Bold',
  w800: 'Archivo_800ExtraBold',
  w900: 'Archivo_900Black',
} as const;

const SPACE_GROTESK = {
  w500: 'SpaceGrotesk_500Medium',
  w600: 'SpaceGrotesk_600SemiBold',
  w700: 'SpaceGrotesk_700Bold',
} as const;

const classicLight: Colors = {
  background: '#F9F6F1',
  card: '#FFFFFF',
  foreground: '#1D1A15',
  muted: '#F0ECE5',
  mutedForeground: '#66635C',
  hairline: 'rgba(29,26,21,0.10)',
  primary: '#0A6580',
  primaryForeground: '#FFFFFF',
  destructive: '#B42318',
  destructiveSoft: '#FDE7E4',
  warning: '#B45309',
  switchOff: '#D6D0C6',
  steps: '#0A6580',
  stepsSoft: '#DCF0F6',
  stepsText: '#07506A',
  heart: '#D12F4D',
  heartSoft: '#FFE4E9',
  heartText: '#A31E39',
  sleep: '#5C69BC',
  sleepSoft: '#E8EDFF',
  sleepText: '#424B8E',
  workouts: '#C2700A',
  workoutsSoft: '#FFEFD6',
  workoutsText: '#8A4E00',
  link: '#177A45',
  linkSoft: '#DFF5E6',
  linkText: '#0F6236',
  stageDeep: '#3F4A9A',
  stageRem: '#8A6BD4',
  stageLight: '#A9B3EA',
  stageAwake: '#E2A03A',
  hero: '#0F2F3A',
  heroEnd: '#0F2F3A',
  heroForeground: '#F2F7F8',
  heroMuted: '#A9C2C9',
  heroTrack: '#24505E',
  heroDivider: 'rgba(242,247,248,0.14)',
  heroSteps: '#5FD3EE',
  heroHeart: '#FF8FA4',
  heroLink: '#6EE7A0',
  heroWarn: '#F5B35A',
  heroAccent: '#F5B35A',
};

const classicDark: Colors = {
  background: '#0D1112',
  card: '#171D1F',
  foreground: '#EEF1F0',
  muted: '#242C2F',
  mutedForeground: '#9BA6A8',
  hairline: 'rgba(238,241,240,0.10)',
  primary: '#58C4DE',
  primaryForeground: '#04222B',
  destructive: '#FF8A80',
  destructiveSoft: '#41201E',
  warning: '#F0A23C',
  switchOff: '#3A4346',
  steps: '#58C4DE',
  stepsSoft: '#12323C',
  stepsText: '#58C4DE',
  heart: '#FF7B93',
  heartSoft: '#42202B',
  heartText: '#FF8FA4',
  sleep: '#8F9BE3',
  sleepSoft: '#262C4A',
  sleepText: '#9AA5E8',
  workouts: '#F0A23C',
  workoutsSoft: '#41300F',
  workoutsText: '#F0A23C',
  link: '#5FD08D',
  linkSoft: '#123324',
  linkText: '#5FD08D',
  stageDeep: '#4B57B5',
  stageRem: '#C09CF5',
  stageLight: '#8F9BE3',
  stageAwake: '#F0A23C',
  hero: '#10303B',
  heroEnd: '#10303B',
  heroForeground: '#F2F7F8',
  heroMuted: '#A9C2C9',
  heroTrack: '#24505E',
  heroDivider: 'rgba(242,247,248,0.14)',
  heroSteps: '#5FD3EE',
  heroHeart: '#FF8FA4',
  heroLink: '#6EE7A0',
  heroWarn: '#F5B35A',
  heroAccent: '#F5B35A',
};

/** Volt on near-black. The volt is the only brand color; data colors are hot and saturated so they pop on black. */
const sportDark: Colors = {
  background: '#0B0B0C',
  card: '#17171A',
  foreground: '#FFFFFF',
  muted: '#242428',
  mutedForeground: '#A3A3AD',
  hairline: 'rgba(255,255,255,0.12)',
  primary: '#D4FF3A',
  primaryForeground: '#0B0B0C',
  destructive: '#FF6B78',
  destructiveSoft: '#3A1519',
  warning: '#FFA040',
  switchOff: '#3A3A41',
  steps: '#D4FF3A',
  stepsSoft: '#252C0B',
  stepsText: '#D4FF3A',
  heart: '#FF4D6A',
  heartSoft: '#3A141E',
  heartText: '#FF8196',
  sleep: '#8F86FF',
  sleepSoft: '#211E48',
  sleepText: '#B3ACFF',
  workouts: '#FF8A1F',
  workoutsSoft: '#3A2008',
  workoutsText: '#FFA550',
  link: '#2EE59D',
  linkSoft: '#0B3324',
  linkText: '#52F0B2',
  stageDeep: '#5B4FE0',
  stageRem: '#C4A8FF',
  stageLight: '#8F86FF',
  stageAwake: '#FF8A1F',
  hero: '#1E2308',
  heroEnd: '#1E2308',
  heroForeground: '#FFFFFF',
  heroMuted: '#B8BFA0',
  heroTrack: '#3A4413',
  heroDivider: 'rgba(255,255,255,0.14)',
  heroSteps: '#D4FF3A',
  heroHeart: '#FF7D92',
  heroLink: '#4DF0A8',
  heroWarn: '#FFA040',
  heroAccent: '#D4FF3A',
};

const oceanLight: Colors = {
  background: '#EFF5FA',
  card: '#FFFFFF',
  foreground: '#0E1B2A',
  muted: '#E3ECF4',
  mutedForeground: '#546579',
  hairline: 'rgba(14,27,42,0.10)',
  primary: '#0B63CE',
  primaryForeground: '#FFFFFF',
  destructive: '#B42318',
  destructiveSoft: '#FDE7E4',
  warning: '#B45309',
  switchOff: '#C9D5E1',
  steps: '#0B63CE',
  stepsSoft: '#DDEBFB',
  stepsText: '#084C9E',
  heart: '#D6304B',
  heartSoft: '#FFE5E9',
  heartText: '#A31F39',
  sleep: '#6757D9',
  sleepSoft: '#ECE9FF',
  sleepText: '#4A3DB0',
  workouts: '#C2700A',
  workoutsSoft: '#FFEFD9',
  workoutsText: '#8A4E00',
  link: '#0C7F60',
  linkSoft: '#DCF4EB',
  linkText: '#086049',
  stageDeep: '#4B3FB8',
  stageRem: '#9A7BE6',
  stageLight: '#B6ACF2',
  stageAwake: '#E2A03A',
  hero: '#0B2A4A',
  heroEnd: '#0B2A4A',
  heroForeground: '#F2F8FF',
  heroMuted: '#A9C4DE',
  heroTrack: '#1F4A73',
  heroDivider: 'rgba(242,248,255,0.14)',
  heroSteps: '#6CC4FF',
  heroHeart: '#FF9BAC',
  heroLink: '#6EE7B7',
  heroWarn: '#FFC266',
  heroAccent: '#6CC4FF',
};

const oceanDark: Colors = {
  background: '#08121D',
  card: '#102030',
  foreground: '#E8F1FA',
  muted: '#1A2D42',
  mutedForeground: '#8FA7BE',
  hairline: 'rgba(232,241,250,0.10)',
  primary: '#5AB0FF',
  primaryForeground: '#04192E',
  destructive: '#FF8A80',
  destructiveSoft: '#41201E',
  warning: '#F0A23C',
  switchOff: '#33475C',
  steps: '#5AB0FF',
  stepsSoft: '#112F4C',
  stepsText: '#7CC2FF',
  heart: '#FF7B93',
  heartSoft: '#42202B',
  heartText: '#FF8FA4',
  sleep: '#9A8DFF',
  sleepSoft: '#262551',
  sleepText: '#AFA5FF',
  workouts: '#F0A23C',
  workoutsSoft: '#41300F',
  workoutsText: '#F0A23C',
  link: '#4FD6A8',
  linkSoft: '#0F3329',
  linkText: '#4FD6A8',
  stageDeep: '#5A4FD0',
  stageRem: '#BBA2F7',
  stageLight: '#9A8DFF',
  stageAwake: '#F0A23C',
  hero: '#0F2D4A',
  heroEnd: '#0F2D4A',
  heroForeground: '#F2F8FF',
  heroMuted: '#A9C4DE',
  heroTrack: '#1F4A73',
  heroDivider: 'rgba(242,248,255,0.14)',
  heroSteps: '#6CC4FF',
  heroHeart: '#FF9BAC',
  heroLink: '#6EE7B7',
  heroWarn: '#FFC266',
  heroAccent: '#6CC4FF',
};

const amoledDark: Colors = {
  background: '#000000',
  card: '#0C0C0E',
  foreground: '#FFFFFF',
  muted: '#1B1B1E',
  mutedForeground: '#9A9AA3',
  hairline: 'rgba(255,255,255,0.12)',
  primary: '#FFFFFF',
  primaryForeground: '#000000',
  destructive: '#FF6B6B',
  destructiveSoft: '#331B1D',
  warning: '#FFA03A',
  switchOff: '#3A3A3F',
  steps: '#4CCBFF',
  stepsSoft: '#172C37',
  stepsText: '#4CCBFF',
  heart: '#FF5577',
  heartSoft: '#351820',
  heartText: '#FF5577',
  sleep: '#9A8CFF',
  sleepSoft: '#242237',
  sleepText: '#9A8CFF',
  workouts: '#FFA03A',
  workoutsSoft: '#352515',
  workoutsText: '#FFA03A',
  link: '#35DB92',
  linkSoft: '#132F24',
  linkText: '#35DB92',
  stageDeep: '#5B4FE0',
  stageRem: '#C4A8FF',
  stageLight: '#8F86FF',
  stageAwake: '#FFA03A',
  hero: '#141417',
  heroEnd: '#141417',
  heroForeground: '#FFFFFF',
  heroMuted: '#A8A8B2',
  heroTrack: '#2E2E34',
  heroDivider: 'rgba(255,255,255,0.14)',
  heroSteps: '#5BD2FF',
  heroHeart: '#FF7C96',
  heroLink: '#4DE6A3',
  heroWarn: '#FFB454',
  heroAccent: '#FFB454',
};

const soganLight: Colors = {
  background: '#F2E8D5',
  card: '#FBF6EA',
  foreground: '#2A1B0E',
  muted: '#E8DAC0',
  mutedForeground: '#6B5238',
  hairline: 'rgba(42,27,14,0.10)',
  primary: '#7B3F14',
  primaryForeground: '#FFFFFF',
  destructive: '#A12A1C',
  destructiveSoft: '#EED9CD',
  warning: '#A15A00',
  switchOff: '#CDB994',
  steps: '#7B3F14',
  stepsSoft: '#EADECE',
  stepsText: '#7B3F14',
  heart: '#B3283F',
  heartSoft: '#F2DBD4',
  heartText: '#B3283F',
  sleep: '#4F5BA6',
  sleepSoft: '#E5E2E1',
  sleepText: '#4F5BA6',
  workouts: '#B8700F',
  workoutsSoft: '#F2E5CE',
  workoutsText: '#91580C',
  link: '#3F7A3A',
  linkSoft: '#E3E6D3',
  linkText: '#396F35',
  stageDeep: '#3F4A8F',
  stageRem: '#8A6BC0',
  stageLight: '#A9B0DC',
  stageAwake: '#D99A2B',
  hero: '#3B2412',
  heroEnd: '#3B2412',
  heroForeground: '#FBF1DF',
  heroMuted: '#CDB594',
  heroTrack: '#5A3A20',
  heroDivider: 'rgba(251,241,223,0.14)',
  heroSteps: '#E8B04A',
  heroHeart: '#F29AA6',
  heroLink: '#9FD38F',
  heroWarn: '#F0B35A',
  heroAccent: '#E8B04A',
};

const soganDark: Colors = {
  background: '#1B120B',
  card: '#261A10',
  foreground: '#F3E7D3',
  muted: '#33241A',
  mutedForeground: '#B8A184',
  hairline: 'rgba(243,231,211,0.12)',
  primary: '#E3A25B',
  primaryForeground: '#2A1700',
  destructive: '#FF8A7A',
  destructiveSoft: '#492C21',
  warning: '#E8B04A',
  switchOff: '#4A3828',
  steps: '#E3A25B',
  stepsSoft: '#46311D',
  stepsText: '#E3A25B',
  heart: '#F07A8A',
  heartSoft: '#482A25',
  heartText: '#F07A8A',
  sleep: '#9AA5E8',
  sleepSoft: '#3A3235',
  sleepText: '#9AA5E8',
  workouts: '#E8B04A',
  workoutsSoft: '#47341A',
  workoutsText: '#E8B04A',
  link: '#8CC77F',
  linkSoft: '#373723',
  linkText: '#8CC77F',
  stageDeep: '#4B57B5',
  stageRem: '#B79BE0',
  stageLight: '#8F9BE3',
  stageAwake: '#E8B04A',
  hero: '#3A2514',
  heroEnd: '#3A2514',
  heroForeground: '#FBF1DF',
  heroMuted: '#CDB594',
  heroTrack: '#5A3A20',
  heroDivider: 'rgba(251,241,223,0.14)',
  heroSteps: '#E8B04A',
  heroHeart: '#F29AA6',
  heroLink: '#9FD38F',
  heroWarn: '#F0B35A',
  heroAccent: '#E8B04A',
};

const neonDark: Colors = {
  background: '#07070E',
  card: '#12121C',
  foreground: '#F5F5FF',
  muted: '#1D1D2B',
  mutedForeground: '#9C9CB8',
  hairline: 'rgba(245,245,255,0.12)',
  primary: '#FF2E97',
  primaryForeground: '#0B0B0C',
  destructive: '#FF6B7A',
  destructiveSoft: '#38202B',
  warning: '#FFB020',
  switchOff: '#383850',
  steps: '#19E8F5',
  stepsSoft: '#133641',
  stepsText: '#19E8F5',
  heart: '#FF4D6D',
  heartSoft: '#3A1C2A',
  heartText: '#FF4D6D',
  sleep: '#A78BFF',
  sleepSoft: '#2B2743',
  sleepText: '#A78BFF',
  workouts: '#FFB020',
  workoutsSoft: '#3A2D1D',
  workoutsText: '#FFB020',
  link: '#39F58A',
  linkSoft: '#19392F',
  linkText: '#39F58A',
  stageDeep: '#6A4FE8',
  stageRem: '#C9A8FF',
  stageLight: '#8F86FF',
  stageAwake: '#FFB020',
  hero: '#1A0F2E',
  heroEnd: '#1A0F2E',
  heroForeground: '#FFFFFF',
  heroMuted: '#B9B2D6',
  heroTrack: '#38285C',
  heroDivider: 'rgba(255,255,255,0.14)',
  heroSteps: '#3DF0FF',
  heroHeart: '#FF7C94',
  heroLink: '#5BF7A2',
  heroWarn: '#FFC24D',
  heroAccent: '#FF5AAE',
};

const softLight: Colors = {
  background: '#FAF3EE',
  card: '#FFFFFF',
  foreground: '#2E2430',
  muted: '#F2E7E8',
  mutedForeground: '#6E6378',
  hairline: 'rgba(46,36,48,0.10)',
  primary: '#C45A7C',
  primaryForeground: '#000000',
  destructive: '#B3261E',
  destructiveSoft: '#F4E1E0',
  warning: '#B25E09',
  switchOff: '#DACFD3',
  steps: '#3895A3',
  stepsSoft: '#E5F2F4',
  stepsText: '#2B717C',
  heart: '#E0566F',
  heartSoft: '#FBE9EC',
  heartText: '#B14458',
  sleep: '#8470D6',
  sleepSoft: '#EFECFA',
  sleepText: '#6C5CAF',
  workouts: '#BA7E30',
  workoutsSoft: '#FBF2E5',
  workoutsText: '#936426',
  link: '#509661',
  linkSoft: '#EAF4EC',
  linkText: '#3F764D',
  stageDeep: '#7C68D0',
  stageRem: '#B9A5EE',
  stageLight: '#CFC4F5',
  stageAwake: '#EDB05C',
  hero: '#4A3550',
  heroEnd: '#4A3550',
  heroForeground: '#FFF6F8',
  heroMuted: '#D9C6DC',
  heroTrack: '#6A4F72',
  heroDivider: 'rgba(255,246,248,0.14)',
  heroSteps: '#8FDDE8',
  heroHeart: '#FFA3B5',
  heroLink: '#A5E2B4',
  heroWarn: '#FFC878',
  heroAccent: '#FFB3C6',
};

const softDark: Colors = {
  background: '#1F1A24',
  card: '#2A2330',
  foreground: '#F6EEF4',
  muted: '#383040',
  mutedForeground: '#B6A9BE',
  hairline: 'rgba(246,238,244,0.12)',
  primary: '#F29AB5',
  primaryForeground: '#3A1424',
  destructive: '#FF9A92',
  destructiveSoft: '#4C3640',
  warning: '#F0B060',
  switchOff: '#4E4458',
  steps: '#7FD1DD',
  stepsSoft: '#38414D',
  stepsText: '#7FD1DD',
  heart: '#FF8CA3',
  heartSoft: '#4E3544',
  heartText: '#FF8CA3',
  sleep: '#B6A6F2',
  sleepSoft: '#423951',
  sleepText: '#B6A6F2',
  workouts: '#F2B766',
  workoutsSoft: '#4C3C39',
  workoutsText: '#F2B766',
  link: '#8FD3A0',
  linkSoft: '#3B4143',
  linkText: '#8FD3A0',
  stageDeep: '#7C68D0',
  stageRem: '#C9B8F5',
  stageLight: '#A99AE8',
  stageAwake: '#F2B766',
  hero: '#3A2D44',
  heroEnd: '#3A2D44',
  heroForeground: '#FFF6F8',
  heroMuted: '#D9C6DC',
  heroTrack: '#5A4A66',
  heroDivider: 'rgba(255,246,248,0.14)',
  heroSteps: '#8FDDE8',
  heroHeart: '#FFA3B5',
  heroLink: '#A5E2B4',
  heroWarn: '#FFC878',
  heroAccent: '#FFB3C6',
};

const monoLight: Colors = {
  background: '#FFFFFF',
  card: '#F4F4F4',
  foreground: '#000000',
  muted: '#E4E4E4',
  mutedForeground: '#4A4A4A',
  hairline: 'rgba(0,0,0,0.28)',
  primary: '#000000',
  primaryForeground: '#FFFFFF',
  destructive: '#BE0000',
  destructiveSoft: '#EDD2D2',
  warning: '#6B4A00',
  switchOff: '#B8B8B8',
  steps: '#111111',
  stepsSoft: '#D6D6D6',
  stepsText: '#111111',
  heart: '#D40000',
  heartSoft: '#F0D4D4',
  heartText: '#C10000',
  sleep: '#4A4A4A',
  sleepSoft: '#DEDEDE',
  sleepText: '#4A4A4A',
  workouts: '#6E6E6E',
  workoutsSoft: '#E3E3E3',
  workoutsText: '#646464',
  link: '#2B2B2B',
  linkSoft: '#DADADA',
  linkText: '#2B2B2B',
  stageDeep: '#1A1A1A',
  stageRem: '#6A6A6A',
  stageLight: '#A8A8A8',
  stageAwake: '#D40000',
  hero: '#000000',
  heroEnd: '#000000',
  heroForeground: '#FFFFFF',
  heroMuted: '#BDBDBD',
  heroTrack: '#3A3A3A',
  heroDivider: 'rgba(255,255,255,0.14)',
  heroSteps: '#FFFFFF',
  heroHeart: '#FF6060',
  heroLink: '#E0E0E0',
  heroWarn: '#D9D9D9',
  heroAccent: '#FFFFFF',
};

const monoDark: Colors = {
  background: '#000000',
  card: '#111111',
  foreground: '#FFFFFF',
  muted: '#222222',
  mutedForeground: '#B5B5B5',
  hairline: 'rgba(255,255,255,0.30)',
  primary: '#FFFFFF',
  primaryForeground: '#000000',
  destructive: '#FF5050',
  destructiveSoft: '#371B1B',
  warning: '#D9D9D9',
  switchOff: '#4A4A4A',
  steps: '#FFFFFF',
  stepsSoft: '#393939',
  stepsText: '#FFFFFF',
  heart: '#FF4040',
  heartSoft: '#391919',
  heartText: '#FF4646',
  sleep: '#BDBDBD',
  sleepSoft: '#2E2E2E',
  sleepText: '#BDBDBD',
  workouts: '#8F8F8F',
  workoutsSoft: '#262626',
  workoutsText: '#8F8F8F',
  link: '#D9D9D9',
  linkSoft: '#333333',
  linkText: '#D9D9D9',
  stageDeep: '#8A8A8A',
  stageRem: '#D0D0D0',
  stageLight: '#5A5A5A',
  stageAwake: '#FF4040',
  hero: '#1C1C1C',
  heroEnd: '#1C1C1C',
  heroForeground: '#FFFFFF',
  heroMuted: '#BDBDBD',
  heroTrack: '#444444',
  heroDivider: 'rgba(255,255,255,0.14)',
  heroSteps: '#FFFFFF',
  heroHeart: '#FF6060',
  heroLink: '#E0E0E0',
  heroWarn: '#D9D9D9',
  heroAccent: '#FFFFFF',
};

const retroLight: Colors = {
  background: '#F6EAD3',
  card: '#FFF8E8',
  foreground: '#2B1A12',
  muted: '#EBDCBF',
  mutedForeground: '#6A5642',
  hairline: 'rgba(43,26,18,0.10)',
  primary: '#E4572E',
  primaryForeground: '#2B1A12',
  destructive: '#B3261E',
  destructiveSoft: '#F4DBCC',
  warning: '#A15A00',
  switchOff: '#D2C2A2',
  steps: '#D9531E',
  stepsSoft: '#FAE3CE',
  stepsText: '#AB4218',
  heart: '#C2253F',
  heartSoft: '#F7DDD2',
  heartText: '#BC243D',
  sleep: '#2E5E8C',
  sleepSoft: '#E4E4DC',
  sleepText: '#2E5E8C',
  workouts: '#B1790A',
  workoutsSoft: '#F8EACB',
  workoutsText: '#8C6008',
  link: '#3F7D4E',
  linkSoft: '#E6E8D4',
  linkText: '#376E45',
  stageDeep: '#244A70',
  stageRem: '#7E9FC4',
  stageLight: '#AFC4DB',
  stageAwake: '#E8A317',
  hero: '#2B1A12',
  heroEnd: '#2B1A12',
  heroForeground: '#FFF1D6',
  heroMuted: '#D3BFA0',
  heroTrack: '#4F3526',
  heroDivider: 'rgba(255,241,214,0.14)',
  heroSteps: '#FF8A5C',
  heroHeart: '#FF8FA0',
  heroLink: '#8FD3A0',
  heroWarn: '#F2B84A',
  heroAccent: '#F2A33A',
};

const forestLight: Colors = {
  background: '#EEF3EA',
  card: '#FFFFFF',
  foreground: '#13241A',
  muted: '#E0E9DB',
  mutedForeground: '#4F6355',
  hairline: 'rgba(19,36,26,0.10)',
  primary: '#1F6B3E',
  primaryForeground: '#FFFFFF',
  destructive: '#B3261E',
  destructiveSoft: '#F4E1E0',
  warning: '#A15A00',
  switchOff: '#C5D3C2',
  steps: '#1F6B3E',
  stepsSoft: '#E2ECE6',
  stepsText: '#1F6B3E',
  heart: '#C0392B',
  heartSoft: '#F7E5E3',
  heartText: '#BA372A',
  sleep: '#4B5FA8',
  sleepSoft: '#E8EAF4',
  sleepText: '#4B5FA8',
  workouts: '#B8730E',
  workoutsSoft: '#F6EDE0',
  workoutsText: '#975E0B',
  link: '#0F7B7B',
  linkSoft: '#E0EEEE',
  linkText: '#0E7474',
  stageDeep: '#3F4F9A',
  stageRem: '#8A7BCB',
  stageLight: '#A9B4E0',
  stageAwake: '#DA9A2B',
  hero: '#123222',
  heroEnd: '#123222',
  heroForeground: '#EAF5EC',
  heroMuted: '#A9C7B3',
  heroTrack: '#2A5640',
  heroDivider: 'rgba(234,245,236,0.14)',
  heroSteps: '#7EDCA0',
  heroHeart: '#FF9A8C',
  heroLink: '#7FE0D6',
  heroWarn: '#F0B35A',
  heroAccent: '#C6F06A',
};

const forestDark: Colors = {
  background: '#0C1610',
  card: '#14231A',
  foreground: '#E6F0E6',
  muted: '#1E3326',
  mutedForeground: '#94AD9C',
  hairline: 'rgba(230,240,230,0.12)',
  primary: '#6FD08C',
  primaryForeground: '#062410',
  destructive: '#FF9A8C',
  destructiveSoft: '#3A362C',
  warning: '#F0B060',
  switchOff: '#35503E',
  steps: '#6FD08C',
  stepsSoft: '#23402D',
  stepsText: '#6FD08C',
  heart: '#FF8A7A',
  heartSoft: '#3C352A',
  heartText: '#FF8A7A',
  sleep: '#9AA8EA',
  sleepSoft: '#2B3A3D',
  sleepText: '#9AA8EA',
  workouts: '#E8B04A',
  workoutsSoft: '#383B22',
  workoutsText: '#E8B04A',
  link: '#5ED6CC',
  linkSoft: '#214138',
  linkText: '#5ED6CC',
  stageDeep: '#4B5BB5',
  stageRem: '#B79BE0',
  stageLight: '#8F9BE3',
  stageAwake: '#E8B04A',
  hero: '#153A26',
  heroEnd: '#153A26',
  heroForeground: '#EAF5EC',
  heroMuted: '#A9C7B3',
  heroTrack: '#2A5640',
  heroDivider: 'rgba(234,245,236,0.14)',
  heroSteps: '#7EDCA0',
  heroHeart: '#FF9A8C',
  heroLink: '#7FE0D6',
  heroWarn: '#F0B35A',
  heroAccent: '#C6F06A',
};

const sunsetDark: Colors = {
  background: '#1A0F12',
  card: '#27171B',
  foreground: '#FFF1EA',
  muted: '#36212A',
  mutedForeground: '#C4A6A8',
  hairline: 'rgba(255,241,234,0.12)',
  primary: '#FF8A4C',
  primaryForeground: '#2A0E00',
  destructive: '#FF8A80',
  destructiveSoft: '#4A292B',
  warning: '#FFB454',
  switchOff: '#523842',
  steps: '#FF8A4C',
  stepsSoft: '#4C2B23',
  stepsText: '#FF8A4C',
  heart: '#FF5C7A',
  heartSoft: '#4C232B',
  heartText: '#FF6682',
  sleep: '#B3A0F0',
  sleepSoft: '#3F2E3F',
  sleepText: '#B3A0F0',
  workouts: '#FFC04D',
  workoutsSoft: '#4C3424',
  workoutsText: '#FFC04D',
  link: '#58D6A4',
  linkSoft: '#2F3732',
  linkText: '#58D6A4',
  stageDeep: '#6B4FD8',
  stageRem: '#D2A8F2',
  stageLight: '#A08FE8',
  stageAwake: '#FFB454',
  hero: '#7A1A44',
  heroEnd: '#9A3412',
  heroForeground: '#FFFDFB',
  heroMuted: '#FFE0D0',
  heroTrack: '#E0764A',
  heroDivider: 'rgba(255,253,251,0.14)',
  heroSteps: '#FFE0A8',
  heroHeart: '#FFD0DA',
  heroLink: '#C6F5DD',
  heroWarn: '#FFE29A',
  heroAccent: '#FFF0B8',
};

const JAKARTA_FONTS: FontFamilies = {
  regular: JAKARTA.w500,
  medium: JAKARTA.w600,
  bold: JAKARTA.w700,
  heavy: JAKARTA.w800,
  numeral: JAKARTA.w800,
  headline: JAKARTA.w800,
};

const classicType: Typography = {
  fonts: JAKARTA_FONTS,
  numeral: {
    hero: { size: 56, line: 60, tracking: -1.5, unit: 15 },
    lg: { size: 32, line: 38, tracking: -0.5, unit: 14 },
    md: { size: 24, line: 30, tracking: -0.3, unit: 13 },
    sm: { size: 18, line: 24, tracking: 0, unit: 12 },
  },
  title: { size: 28, line: 34, tracking: -0.5 },
};

/** Body one weight heavier than classic (the app bundles Jakarta 500 to 800); Bebas Neue, tall and condensed, for the numerals and titles. */
const sportType: Typography = {
  fonts: {
    regular: JAKARTA.w600,
    medium: JAKARTA.w700,
    bold: JAKARTA.w800,
    heavy: JAKARTA.w800,
    numeral: 'BebasNeue_400Regular',
    headline: 'BebasNeue_400Regular',
  },
  numeral: {
    hero: { size: 78, line: 80, tracking: 0.5, unit: 16 },
    lg: { size: 44, line: 46, tracking: 0.4, unit: 14 },
    md: { size: 32, line: 34, tracking: 0.3, unit: 13 },
    sm: { size: 23, line: 26, tracking: 0.2, unit: 12 },
  },
  title: { size: 36, line: 38, tracking: 0.6 },
};

/** Jakarta body, Space Grotesk numerals: a technical, instrument-panel figure. */
const oceanType: Typography = {
  fonts: { ...JAKARTA_FONTS, numeral: SPACE_GROTESK.w700 },
  numeral: {
    hero: { size: 58, line: 62, tracking: -2, unit: 15 },
    lg: { size: 33, line: 38, tracking: -0.8, unit: 14 },
    md: { size: 24, line: 30, tracking: -0.5, unit: 13 },
    sm: { size: 18, line: 24, tracking: -0.2, unit: 12 },
  },
  title: { size: 28, line: 34, tracking: -0.5 },
};

/** Manrope throughout: calm, very large, tightly tracked numerals on the black. */
const amoledType: Typography = {
  fonts: {
    regular: MANROPE.w500,
    medium: MANROPE.w600,
    bold: MANROPE.w700,
    heavy: MANROPE.w800,
    numeral: MANROPE.w800,
    headline: MANROPE.w800,
  },
  numeral: {
    hero: { size: 64, line: 66, tracking: -2.5, unit: 15 },
    lg: { size: 36, line: 42, tracking: -1.2, unit: 14 },
    md: { size: 26, line: 32, tracking: -0.8, unit: 13 },
    sm: { size: 19, line: 24, tracking: -0.3, unit: 12 },
  },
  title: { size: 30, line: 36, tracking: -0.8 },
};

/** Space Grotesk text with JetBrains Mono numerals: a digital readout. Mono glyphs are wide, so the figures are smaller than classic's. */
const neonType: Typography = {
  fonts: {
    regular: SPACE_GROTESK.w500,
    medium: SPACE_GROTESK.w600,
    bold: SPACE_GROTESK.w700,
    heavy: SPACE_GROTESK.w700,
    numeral: 'JetBrainsMono_800ExtraBold',
    headline: SPACE_GROTESK.w700,
  },
  numeral: {
    hero: { size: 50, line: 56, tracking: -1.5, unit: 14 },
    lg: { size: 28, line: 34, tracking: -0.8, unit: 13 },
    md: { size: 21, line: 28, tracking: -0.5, unit: 12 },
    sm: { size: 16, line: 22, tracking: -0.2, unit: 12 },
  },
  title: { size: 28, line: 34, tracking: -0.4 },
};

/** Manrope text and numerals; the only theme with a gradient panel, so the numerals are big and plain on it. */
const sunsetType: Typography = {
  fonts: {
    regular: MANROPE.w500,
    medium: MANROPE.w600,
    bold: MANROPE.w700,
    heavy: MANROPE.w800,
    numeral: SPACE_GROTESK.w700,
    headline: MANROPE.w800,
  },
  numeral: {
    hero: { size: 62, line: 66, tracking: -2.4, unit: 15 },
    lg: { size: 35, line: 40, tracking: -1, unit: 14 },
    md: { size: 25, line: 30, tracking: -0.6, unit: 13 },
    sm: { size: 18, line: 24, tracking: -0.2, unit: 12 },
  },
  title: { size: 30, line: 36, tracking: -0.7 },
};

/** Fraunces (a soft-serif, warm like carved wood) for titles; Manrope for text and the tabular numerals. */
const soganType: Typography = {
  fonts: {
    regular: MANROPE.w500,
    medium: MANROPE.w600,
    bold: MANROPE.w700,
    heavy: MANROPE.w800,
    numeral: MANROPE.w800,
    headline: 'Fraunces_800ExtraBold',
  },
  numeral: {
    hero: { size: 54, line: 58, tracking: -1.4, unit: 15 },
    lg: { size: 31, line: 37, tracking: -0.6, unit: 14 },
    md: { size: 23, line: 29, tracking: -0.4, unit: 13 },
    sm: { size: 17, line: 23, tracking: -0.1, unit: 12 },
  },
  title: { size: 31, line: 37, tracking: -0.6 },
};

/** Archivo Black numerals: heavy, chunky, a little wide, like a 70s race number. */
const retroType: Typography = {
  fonts: {
    regular: ARCHIVO.w500,
    medium: ARCHIVO.w600,
    bold: ARCHIVO.w700,
    heavy: ARCHIVO.w800,
    numeral: ARCHIVO.w900,
    headline: ARCHIVO.w900,
  },
  numeral: {
    hero: { size: 60, line: 64, tracking: -2, unit: 15 },
    lg: { size: 34, line: 40, tracking: -1, unit: 14 },
    md: { size: 25, line: 30, tracking: -0.6, unit: 13 },
    sm: { size: 18, line: 24, tracking: -0.2, unit: 12 },
  },
  title: { size: 29, line: 35, tracking: -0.8 },
};

/** Nunito text, Archivo numerals (sturdy, like trail signs) and Fraunces titles. */
const forestType: Typography = {
  fonts: {
    regular: NUNITO.w500,
    medium: NUNITO.w600,
    bold: NUNITO.w700,
    heavy: NUNITO.w800,
    numeral: ARCHIVO.w800,
    headline: 'Fraunces_800ExtraBold',
  },
  numeral: {
    hero: { size: 58, line: 62, tracking: -1.6, unit: 15 },
    lg: { size: 33, line: 39, tracking: -0.7, unit: 14 },
    md: { size: 24, line: 30, tracking: -0.4, unit: 13 },
    sm: { size: 18, line: 24, tracking: -0.1, unit: 12 },
  },
  title: { size: 31, line: 37, tracking: -0.6 },
};

/** Rounded Nunito everywhere; light-handed tracking so the numerals stay friendly. */
const softType: Typography = {
  fonts: {
    regular: NUNITO.w500,
    medium: NUNITO.w600,
    bold: NUNITO.w700,
    heavy: NUNITO.w800,
    numeral: NUNITO.w800,
    headline: NUNITO.w800,
  },
  numeral: {
    hero: { size: 54, line: 60, tracking: -0.8, unit: 15 },
    lg: { size: 31, line: 38, tracking: -0.3, unit: 14 },
    md: { size: 23, line: 30, tracking: -0.1, unit: 13 },
    sm: { size: 18, line: 24, tracking: 0, unit: 12 },
  },
  title: { size: 28, line: 34, tracking: -0.3 },
};

/** Space Grotesk text, JetBrains Mono for numerals and titles: a terminal, in black and white. */
const monoType: Typography = {
  fonts: {
    regular: SPACE_GROTESK.w500,
    medium: SPACE_GROTESK.w600,
    bold: SPACE_GROTESK.w700,
    heavy: SPACE_GROTESK.w700,
    numeral: 'JetBrainsMono_800ExtraBold',
    headline: 'JetBrainsMono_800ExtraBold',
  },
  numeral: {
    hero: { size: 48, line: 54, tracking: -2, unit: 14 },
    lg: { size: 27, line: 33, tracking: -1, unit: 13 },
    md: { size: 20, line: 27, tracking: -0.6, unit: 12 },
    sm: { size: 16, line: 22, tracking: -0.3, unit: 12 },
  },
  title: { size: 24, line: 32, tracking: -0.8 },
};

export const THEMES: readonly Theme[] = [
  {
    id: 'classic',
    appearance: 'system',
    palettes: { light: classicLight, dark: classicDark },
    radius: { card: 24, tile: 18, input: 14, control: 999, bar: 28 },
    type: classicType,
  },
  {
    id: 'sport',
    appearance: 'dark',
    palettes: { light: sportDark, dark: sportDark },
    radius: { card: 12, tile: 10, input: 8, control: 8, bar: 14 },
    type: sportType,
  },
  {
    id: 'ocean',
    appearance: 'system',
    palettes: { light: oceanLight, dark: oceanDark },
    radius: { card: 20, tile: 16, input: 12, control: 999, bar: 24 },
    type: oceanType,
  },
  {
    id: 'amoled',
    appearance: 'dark',
    palettes: { light: amoledDark, dark: amoledDark },
    radius: { card: 22, tile: 18, input: 14, control: 999, bar: 999 },
    type: amoledType,
  },
  {
    id: 'neon',
    appearance: 'dark',
    palettes: { light: neonDark, dark: neonDark },
    radius: { card: 10, tile: 8, input: 6, control: 6, bar: 12 },
    type: neonType,
  },
  {
    id: 'sunset',
    appearance: 'dark',
    palettes: { light: sunsetDark, dark: sunsetDark },
    radius: { card: 26, tile: 20, input: 14, control: 999, bar: 30 },
    type: sunsetType,
  },
  {
    id: 'sogan',
    appearance: 'system',
    palettes: { light: soganLight, dark: soganDark },
    radius: { card: 14, tile: 10, input: 8, control: 10, bar: 18 },
    type: soganType,
  },
  {
    id: 'retro',
    appearance: 'light',
    palettes: { light: retroLight, dark: retroLight },
    radius: { card: 18, tile: 14, input: 10, control: 14, bar: 16 },
    type: retroType,
  },
  {
    id: 'forest',
    appearance: 'system',
    palettes: { light: forestLight, dark: forestDark },
    radius: { card: 20, tile: 14, input: 10, control: 14, bar: 22 },
    type: forestType,
  },
  {
    id: 'soft',
    appearance: 'system',
    palettes: { light: softLight, dark: softDark },
    radius: { card: 30, tile: 22, input: 18, control: 999, bar: 34 },
    type: softType,
  },
  {
    id: 'mono',
    appearance: 'system',
    palettes: { light: monoLight, dark: monoDark },
    radius: { card: 4, tile: 4, input: 2, control: 2, bar: 4 },
    type: monoType,
  },
];

export const DEFAULT_THEME_ID: ThemeId = 'classic';

export function getTheme(id: ThemeId): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/** A stored value back to a theme id; anything unknown (an old or removed theme) is the default. */
export function parseThemeId(value: string | null | undefined): ThemeId {
  return THEMES.find((theme) => theme.id === value)?.id ?? DEFAULT_THEME_ID;
}

/** The light/dark the theme is drawn in, given what the phone reports. */
export function resolveScheme(theme: Theme, system: Scheme): Scheme {
  return theme.appearance === 'system' ? system : theme.appearance;
}

/** Every font family a theme draws with, once each: what has to be registered before its first frame. */
export function themeFontFamilies(theme: Theme): FontFamilyName[] {
  return [...new Set(Object.values(theme.type.fonts))];
}

export type WatchCategory =
  | 'Band (194x368)'
  | 'Round (466x466)'
  | 'Round (454x454)'
  | 'Fit (408x480)'
  | 'Fit (336x480)';

export interface WatchfaceItem {
  readonly id: string;
  readonly hardwareId?: string;
  readonly title: string;
  readonly author: string;
  readonly width: number;
  readonly height: number;
  readonly sizeLabel: string;
  readonly description: string;
  readonly downloadUrl?: string;
  readonly previewUrl?: string;
  readonly category: WatchCategory;
  readonly tags?: readonly string[];
  readonly savedAt?: number;
}

/** Derives canonical watch chassis category from pixel width and optional height. */
export function resolveCategory(width: number): WatchCategory {
  if (width === 466 || width >= 460) {
    return 'Round (466x466)';
  }
  if (width === 454 || (width >= 430 && width < 460)) {
    return 'Round (454x454)';
  }
  if (width === 408 || (width >= 380 && width < 430)) {
    return 'Fit (408x480)';
  }
  if (width === 336 || (width >= 260 && width < 380)) {
    return 'Fit (336x480)';
  }
  return 'Band (194x368)';
}

/**
 * What the "My watch" tab offers for putting a .hwt on the watch. `import`: save into the phone library (needs the
 * native package parser, Android only). `install`: send the picked file to the watch straight away (iOS, whose module
 * cannot read a package). `update`: an Android binary that predates the parser.
 */
export type LibraryEntry = 'import' | 'install' | 'update';

export function libraryEntry(os: string, hasParser: boolean): LibraryEntry {
  if (os === 'ios') return 'install';
  return hasParser ? 'import' : 'update';
}

import type { WatchfaceList } from '@/wear';

/** Where an install comes from: a user .hwt, or something the watch never checks for a signature. */
export type InstallSource = 'user-hwt' | 'photo' | 'huawei';

/**
 * True when a user-supplied .hwt will likely be deleted by the watch: it reported the watch face
 * signature capability (bit 8). Unknown capability (not read yet, or an older binary) never warns.
 */
export function shouldWarnUnsigned(list: Pick<WatchfaceList, 'requiresSignature'> | null | undefined, source: InstallSource): boolean {
  return source === 'user-hwt' && list?.requiresSignature === true;
}

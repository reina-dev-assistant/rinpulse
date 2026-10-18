import type { SQLiteDatabase } from 'expo-sqlite';

import type { DayStrain } from '@/features/today/strain';

import { applyRideLoad, listRideMetrics, rideLoadDeltas, syncRideMetrics } from './store';
import { rideProfile } from './settings';

/** Rides the load reads at most this many days back, and at most this many are analysed per screen visit (each is read once, then cached). */
const LOAD_DAYS = 60;
const SYNC_LIMIT = 4;

/** `days` with the rides' load applied; computes the figures of rides that have none yet (a few per call). Never throws: a ride that cannot be read leaves the days as they are. */
export async function withRideLoad(db: SQLiteDatabase, days: readonly DayStrain[], nowSec: number): Promise<DayStrain[]> {
  try {
    const profile = rideProfile();
    if (profile.ftp === null) return [...days];
    const sinceSec = nowSec - LOAD_DAYS * 86400;
    await syncRideMetrics(db, profile, { sinceSec, limit: SYNC_LIMIT });
    return applyRideLoad(days, rideLoadDeltas(await listRideMetrics(db, sinceSec), profile.ftp));
  } catch {
    return [...days];
  }
}

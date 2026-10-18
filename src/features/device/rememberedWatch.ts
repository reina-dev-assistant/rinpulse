import type { SQLiteDatabase } from 'expo-sqlite';

import { hasStoredWatch } from '@/db/queries';
import { HuaweiWear } from '@/wear';

/** A watch this phone already knows: linked now, remembered for the background link, or stored by an earlier sync. */
export async function rememberedWatch(db: SQLiteDatabase): Promise<boolean> {
  if (HuaweiWear.getDevice() !== null || HuaweiWear.getBackgroundStatus().address !== null) return true;
  try {
    return await hasStoredWatch(db);
  } catch {
    return false;
  }
}

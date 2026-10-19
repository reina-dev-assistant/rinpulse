import type { SQLiteDatabase } from 'expo-sqlite';

import { t } from '@/i18n';
import migrationsJson from '../../modules/huawei-wear/schema/joyofit-db-migrations.json';

/**
 * Ordered schema migrations, shared with the native side (it reads the same JSON as an Android
 * asset). Each entry is a list of single SQL statements. `PRAGMA user_version` holds the number of
 * migrations already applied, so entry `i` upgrades a database from version `i` to `i + 1`. Never
 * edit a shipped entry; append.
 */
const MIGRATIONS: readonly (readonly string[])[] = migrationsJson;

/** How long a statement waits for a lock the native writer (same SQLite library, same file) holds; the same wait as the native side. */
export const BUSY_TIMEOUT_MS = 10_000;

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  await db.execAsync('PRAGMA journal_mode = WAL');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > MIGRATIONS.length) {
    throw new Error(t('common:errors.dbNewer', { current, max: MIGRATIONS.length }));
  }
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version].join(';\n');
    // IMMEDIATE takes the write lock now and waits for the native writer's transaction. The version is read again under the
    // lock: the native side runs the same migrations on its own connection and may have applied this step meanwhile.
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      const applied = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if ((applied?.user_version ?? 0) <= version) {
        await db.execAsync(sql);
        await db.execAsync(`PRAGMA user_version = ${version + 1}`);
      }
      await db.execAsync('COMMIT');
    } catch (e) {
      await db.execAsync('ROLLBACK').catch(() => undefined);
      throw e;
    }
  }
}

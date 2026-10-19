/**
 * What SQLite and the Android framework say when a database file is damaged: SQLITE_CORRUPT (11) is "database disk image is
 * malformed" (also what the native writer's SQLiteDatabaseCorruptException carries), SQLITE_NOTADB (26) is "file is not a
 * database". "malformed database schema" is the same code with the offending object named.
 */
const CORRUPTION = /database disk image is malformed|malformed database schema|file is not a database|file is encrypted or is not a database|\bSQLITE_CORRUPT\b|\bSQLITE_NOTADB\b/i;

/**
 * What SQLite says when the file is fine but cannot be used right now: a disk or I/O error, no permission or a locked phone
 * (iOS data protection makes the file unreadable until first unlock or while locked), a file that cannot be opened, a lock held
 * by someone else. None of these is damage, and a repair started for them would copy or replace a healthy database.
 */
const UNAVAILABLE = /disk I\/O error|unable to open database|\bSQLITE_(IOERR|CANTOPEN|PERM|AUTH|BUSY|LOCKED|FULL|READONLY)\w*|operation not permitted|permission denied|not authorized|data protection|database or disk is full|database is locked|attempt to write a readonly database/i;

const MAX_CAUSES = 5;

/** The text of an error and of its `cause` chain; native rejections wrap the real error ("-> Caused by: ...") inside the message. */
function messages(error: unknown): string[] {
  const out: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSES && current !== undefined && current !== null; depth++) {
    out.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return out;
}

/** True when `error` says the database file itself is damaged, from expo-sqlite (JS side) or the native module (Kotlin side). */
export function isCorruptionError(error: unknown): boolean {
  return messages(error).some((text) => CORRUPTION.test(text) && !UNAVAILABLE.test(text));
}

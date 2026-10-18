/**
 * What SQLite and the Android framework say when a database file is damaged: SQLITE_CORRUPT (11) is "database disk image is
 * malformed" (also what the native writer's SQLiteDatabaseCorruptException carries), SQLITE_NOTADB (26) is "file is not a
 * database". "malformed database schema" is the same code with the offending object named.
 */
const CORRUPTION = /database disk image is malformed|malformed database schema|file is not a database|file is encrypted or is not a database|\bSQLITE_CORRUPT\b|\bSQLITE_NOTADB\b/i;

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
  return messages(error).some((text) => CORRUPTION.test(text));
}

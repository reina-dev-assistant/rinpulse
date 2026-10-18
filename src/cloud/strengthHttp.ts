import { CloudHttpError, CloudNotConfiguredError, NotSignedInError, withRetry } from '@/cloud/api';
import { RogoError, rogoCall } from '@/cloud/rogo';

/**
 * A request to JoyoRogo's `strength/*` and `exercise/*Joyofit` procedures with the cloud client's retry rules: network errors,
 * 408/425/429 and 5xx wait and retry; every other answer is final. A refusal surfaces as `CloudHttpError`, the same class the
 * rest of the cloud code uses (`RogoError` would be retried like a network failure by `withRetry`).
 */
export function strengthCall<T>(path: string, input: unknown): Promise<T> {
  return withRetry(async () => {
    try {
      return await rogoCall<T>(path, input);
    } catch (error) {
      if (error instanceof RogoError) throw new CloudHttpError(error.status, error.code, null);
      throw error;
    }
  });
}

/** Not an error worth showing or logging: nobody is signed in, the build has no cloud, or this JoyoRogo does not have the procedure yet. */
export function isQuietCloudError(error: unknown): boolean {
  return (
    error instanceof NotSignedInError ||
    error instanceof CloudNotConfiguredError ||
    (error instanceof CloudHttpError && error.status === 404)
  );
}

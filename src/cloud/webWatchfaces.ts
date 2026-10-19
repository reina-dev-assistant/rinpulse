import { File, Paths } from 'expo-file-system';

import { cloudRequest, CloudHttpError, CloudNotConfiguredError, NotSignedInError, withRetry } from '@/cloud/api';
import { authClient } from '@/cloud/auth';
import { CLOUD_CONFIGURED, CLOUD_URL } from '@/cloud/config';
import { parseWebFaces, type WebFace } from '@/features/watchfaces/webLibraryModel';

/** `GET /v1/watchfaces`: the account's web watch face library, newest first. Open to every signed-in account. */
export async function listWebWatchfaces(): Promise<WebFace[]> {
  return parseWebFaces(await cloudRequest<unknown>('GET', '/v1/watchfaces'));
}

/**
 * `GET /v1/watchfaces/:id/file` with the session cookie, saved into the cache as a `.hwt` the install pipeline can read.
 * Returns the `file://` uri and the file name to show. Transient failures are retried like every other cloud call.
 */
export async function downloadWebWatchface(face: WebFace): Promise<{ uri: string; name: string }> {
  if (!CLOUD_CONFIGURED) throw new CloudNotConfiguredError();
  const cookie = await authClient.getCookie();
  if (!cookie) throw new NotSignedInError();
  const name = /\.hwt$/i.test(face.filename) ? face.filename : `${face.id}.hwt`;
  const target = new File(Paths.cache, `web-face-${face.id}.hwt`);
  await withRetry(async () => {
    try {
      await File.downloadFileAsync(`${CLOUD_URL}/v1/watchfaces/${encodeURIComponent(face.id)}/file`, target, {
        headers: { Cookie: cookie },
        idempotent: true,
      });
    } catch (e) {
      // The native error carries the status in its message; surface 404 (deleted on the web meanwhile) as an HTTP error.
      const status = /\b(401|403|404|429|5\d\d)\b/.exec(e instanceof Error ? e.message : '')?.[1];
      if (status) throw new CloudHttpError(Number(status), null, null);
      throw e;
    }
  });
  return { uri: target.uri, name };
}

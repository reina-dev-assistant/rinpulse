import { useEffect, useState } from 'react';

import { authClient } from '@/cloud/auth';

/**
 * The `Cookie` header of the JoyoRogo session, for an `<Image>` that loads a picture only the signed-in viewer may see
 * (a comment photo). `null` until the cookie is read, so the image waits instead of asking without it.
 */
export function useSessionHeaders(): Record<string, string> | null {
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    void authClient.getCookie().then((cookie) => {
      if (live) setHeaders(cookie ? { Cookie: cookie } : {});
    });
    return () => {
      live = false;
    };
  }, []);
  return headers;
}

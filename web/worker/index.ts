/**
 * Entry Worker for JoyoFit Studio.
 *
 * Studio is built with Vite `base: "/studio/"`, so the browser asks for `/studio/assets/x.js` while the built files sit at
 * the root of the asset store (`/assets/x.js`). This Worker maps the public prefix onto the store and nothing else: it
 * runs first for every request (`assets.run_worker_first`), so a request that is not under `/studio` never gets Studio's
 * `index.html` (on app.fit.joyorogo.com only `/studio` and `/studio/*` are routed here; the rest is the JoyoFit web app's).
 *
 * A Worker entry module may only export the handler (workerd rejects other named exports), so the helpers stay private.
 */

const STUDIO_BASE = "/studio";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** The asset-store path for a public path, or null when the path is outside `/studio/`. */
function assetPath(pathname: string): string | null {
  return pathname.startsWith(`${STUDIO_BASE}/`) ? pathname.slice(STUDIO_BASE.length) : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === STUDIO_BASE) {
      url.pathname = `${STUDIO_BASE}/`;
      return Response.redirect(url, 308);
    }
    const path = assetPath(url.pathname);
    if (path === null) {
      // workers.dev root and anything else: the editor lives under /studio/.
      return Response.redirect(new URL(`${STUDIO_BASE}/`, url), 302);
    }
    url.pathname = path;
    return env.ASSETS.fetch(new Request(url, request));
  },
};

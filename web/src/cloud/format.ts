/** Display helpers of the cloud dialog: sizes and times as the active language writes them. */

/** Human size: bytes under 1 KB, KB under 1 MB, then MB with one decimal. */
export function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${new Intl.NumberFormat(locale).format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: bytes < 10 * 1024 ? 1 : 0 }).format(bytes / 1024)} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now" style relative time up to a week, then a plain date. */
export function formatUpdated(at: number, now: number, locale: string): string {
  const diff = now - at;
  if (diff < 0 || diff >= 7 * DAY) return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: diff >= 300 * DAY ? "numeric" : undefined }).format(at);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diff < MINUTE) return rtf.format(0, "second");
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), "minute");
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), "hour");
  return rtf.format(-Math.floor(diff / DAY), "day");
}

const WEB_HOST = "app.fit.joyorogo.com";

/**
 * Link into the JoyoFit web app: relative on its own host (Studio is mounted there), absolute anywhere else (workers.dev,
 * localhost), the same rule the back-to-web link follows.
 */
export function webUrl(path: string, hostname: string = location.hostname): string {
  return hostname === WEB_HOST ? path : `https://${WEB_HOST}${path}`;
}

export const LOGIN_PATH = "/login?redirect=/studio/";
export const PRICING_PATH = "/harga";

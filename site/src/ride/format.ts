/** m:ss, or h:mm:ss from an hour on. */
export function formatTime(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** m:ss.t for segment timers. */
export function formatTimeTenths(totalS: number): string {
  const tenths = Math.max(0, Math.floor(totalS * 10));
  const t = tenths % 10;
  return `${formatTime(tenths / 10)}.${t}`;
}

export function formatKm(m: number, digits = 2): string {
  return (m / 1000).toFixed(digits);
}

/** Gradient as "+6.4" or "\u22122.1" (real minus sign), one decimal. */
export function formatGrade(grade: number): string {
  const v = Math.round(grade * 10) / 10;
  return `${v > 0 ? "+" : v < 0 ? "\u2212" : ""}${Math.abs(v).toFixed(1)}`;
}

/** Heart-rate zone colours: cool to hot, readable on the dark HUD. */
export const ZONE_COLORS = ["#6f8fa8", "#4f9f86", "#7fbf4c", "#e8a23b", "#e05a47"] as const;

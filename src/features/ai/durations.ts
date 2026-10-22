/**
 * Durations in the data are minutes (keys like `sleepMin`), and models repeat them as "684 minutes". People read "11 jam 24 menit".
 * The system prompt asks for hours and minutes; this is the net under it: a number of 90 or more followed by "minutes" / "menit"
 * (or "min"/"mins") becomes "Xh Ym" / "X jam Y menit". Shorter ones stay as written ("45 minutes" reads fine). Pure, total.
 */
const RE = /(?<![\d.,])(\d{2,4})(?:[\s\u00a0-])?(minutes|minute|mins|min|menit)\b/gi;

export const MIN_REWRITE = 90;

export function hoursAndMinutes(total: number, locale: 'id' | 'en'): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (locale === 'id') return m === 0 ? `${h} jam` : `${h} jam ${m} menit`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatDurations(text: string, locale: 'id' | 'en'): string {
  return text.replace(RE, (whole, digits: string) => {
    const total = Number(digits);
    return total >= MIN_REWRITE ? hoursAndMinutes(total, locale) : whole;
  });
}

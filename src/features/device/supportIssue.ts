import { watchDisplayName } from '@/features/device/watchName';
import type { SupportReport } from '@/wear';

export const REPO_URL = 'https://github.com/dzulfikar08/joyofit';

/** Browsers and GitHub start refusing long links around 8 KB; the summary is cut to stay well under it. */
const MAX_URL = 7000;

/** The model name on top of the report; the raw Bluetooth name stays in the summary below it. Null when no watch is named. */
function reportHeader(report: SupportReport): string | null {
  if (!report.watch) return null;
  return `Watch model: ${watchDisplayName({ name: report.watch, model: report.model })}`;
}

/** The whole report as one text, for the clipboard and the share sheet. */
export function reportText(report: SupportReport): string {
  const header = reportHeader(report);
  return `${header ? `${header}\n` : ''}${report.summary}\n\n${report.log}`;
}

// i18n-ok: the issue is written for the maintainers' GitHub tracker, which is English.
/**
 * A new watch-report issue with the watch and the summary in a prefilled body. Form-field parameters
 * (`template=` plus field ids) were dropped on the phone: only the title arrived. A plain `body` is honoured
 * everywhere. The log does not fit a link; the user pastes it under "Log".
 */
export function issueUrl(report: SupportReport): string {
  const what = report.watch ? watchDisplayName({ name: report.watch, model: report.model }) : 'unknown watch';
  const body = (summary: string) =>
    [
      `**Watch:** ${report.watch ?? 'no name'} (${report.model ?? 'not in the list'}, ${report.support})`,
      '',
      '### What works and what does not',
      '',
      'Connects: ',
      'Sync (steps, sleep, heart rate, workouts): ',
      'Other: ',
      '',
      '### Summary',
      '```',
      summary,
      '```',
      '',
      '### Log',
      '<!-- JoyoFit copied the full report to your clipboard. Paste it between the fences. -->',
      '```',
      '',
      '```',
    ].join('\n');
  const params = (summary: string) =>
    Object.entries({ title: `[Watch report] ${what} (${report.support})`, labels: 'watch-report', body: body(summary) })
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
  let summary = report.summary;
  let url = `${REPO_URL}/issues/new?${params(summary)}`;
  while (url.length > MAX_URL && summary.length > 0) {
    summary = summary.slice(0, Math.floor(summary.length * 0.8));
    url = `${REPO_URL}/issues/new?${params(`${summary}\n(cut; the full summary is in the log)`)}`;
  }
  return url;
}

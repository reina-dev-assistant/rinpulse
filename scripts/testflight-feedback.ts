#!/usr/bin/env bun
// Pulls TestFlight feedback (screenshot + crash submissions) for one App Store Connect app, saves raw JSON,
// screenshots and crash logs, and (optionally) files one Atur issue per new item.
//
//   bun scripts/testflight-feedback.ts --app 6823324343 --name joyofit            # summary only, new items
//   bun scripts/testflight-feedback.ts --app 6823222101 --name joyorogo --atur     # + one Atur issue per new item
//   bun scripts/testflight-feedback.ts --app 6823324343 --all                      # ignore state: process everything
//
// Flags: --app <ASC app id> (required) --name <slug, default = app id> --out <dir> (default ./tf-feedback/<name>;
// state.json lives there) --atur --project <Atur project id> --workspace <slug, default joyodigitama> --all --dry
// --repo <owner/name> (resolve each build to its commit through the repo's `release-ios.yml` runs, needs `gh`)
// --since <ISO date> (first run only, when there is no state file yet: items created at or after it are new; without it
// the first run is a baseline that records everything as seen and files nothing; env TF_FEEDBACK_SINCE does the same)
//
// Env (ASC): ASC_KEY_ID (default BUU2CPKLGM), ASC_ISSUER_ID (default the team issuer), and the .p8 as ASC_KEY_P8
// (PEM text), ASC_KEY_P8_BASE64, or ASC_KEY_PATH (default ~/Downloads/AuthKey_<id>.p8).
// Env (Atur): ATUR_API_KEY, else ATUR_API_KEY_FILE, else ~/.config/atur/crew-api-key; ATUR_BASE_URL (default
// https://app.diatur.com).
//
// "Last seen" is the set of processed submission ids in state.json (ASC ids are opaque and not ordered, so a set, not a
// cursor). Atur creation is additionally idempotent: the submission id is in the issue title and searched before
// creating, so a runner that lost its state file does not file the same item twice.
import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ASC = 'https://api.appstoreconnect.apple.com';

type Json = Record<string, any>;
type Kind = 'screenshot' | 'crash';
export type Item = {
  id: string;
  kind: Kind;
  createdDate: string;
  comment: string | null;
  email: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  locale: string | null;
  connectionType: string | null;
  batteryPercentage: number | null;
  appUptimeInMilliseconds: number | null;
  build: { id: string; version: string | null; uploadedDate: string | null; preRelease: string | null; commit?: string | null } | null;
  tester: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null;
  screenshotFiles: string[];
  crashLogFile: string | null;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function ascKey(keyId: string): string {
  if (process.env.ASC_KEY_P8) return process.env.ASC_KEY_P8;
  if (process.env.ASC_KEY_P8_BASE64) return Buffer.from(process.env.ASC_KEY_P8_BASE64, 'base64').toString('utf8');
  return readFileSync(process.env.ASC_KEY_PATH ?? join(homedir(), 'Downloads', `AuthKey_${keyId}.p8`), 'utf8');
}

// ES256 JWT, 15 min lifetime (ASC caps at 20). Raw r||s signature, not DER.
function ascToken(): string {
  const keyId = process.env.ASC_KEY_ID ?? 'BUU2CPKLGM';
  const issuer = process.env.ASC_ISSUER_ID ?? '9e34111d-e39f-4122-9000-6eb4628fe9b9';
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: issuer, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  const sig = createSign('SHA256').update(`${head}.${claims}`).sign({ key: ascKey(keyId), dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${b64url(sig)}`;
}

let token = '';
async function asc(path: string): Promise<Json> {
  token ||= ascToken();
  const res = await fetch(path.startsWith('http') ? path : ASC + path, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ASC GET ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Json;
}

async function ascAll(path: string): Promise<{ data: Json[]; included: Json[] }> {
  const data: Json[] = [];
  const included: Json[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: Json = await asc(next);
    data.push(...(page.data ?? []));
    included.push(...(page.included ?? []));
    next = page.links?.next;
  }
  return { data, included };
}

async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${file} -> ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function attrOf(included: Json[], type: string, id: string | undefined): Json | undefined {
  return id ? included.find((r) => r.type === type && r.id === id)?.attributes : undefined;
}

async function collect(appId: string, out: string): Promise<{ items: Item[]; raw: Json }> {
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  mkdirSync(join(out, 'crashlogs'), { recursive: true });
  const items: Item[] = [];
  const raw: Json = { screenshots: [], crashes: [] };

  for (const kind of ['screenshot', 'crash'] as const) {
    const edge = kind === 'screenshot' ? 'betaFeedbackScreenshotSubmissions' : 'betaFeedbackCrashSubmissions';
    const { data, included } = await ascAll(
      `/v1/apps/${appId}/${edge}?limit=200&sort=-createdDate&include=build,tester`,
    );
    for (const sub of data) {
      const a = sub.attributes ?? {};
      const buildId = sub.relationships?.build?.data?.id;
      const testerId = sub.relationships?.tester?.data?.id;
      const build = attrOf(included, 'builds', buildId);
      let preRelease: string | null = null;
      if (buildId) {
        // Marketing version of the build; one cheap request per distinct build is fine at this volume.
        const pre = await asc(`/v1/builds/${buildId}/preReleaseVersion`).catch(() => null);
        preRelease = pre?.data?.attributes?.version ?? null;
      }
      const tester = attrOf(included, 'betaTesters', testerId);

      const screenshotFiles: string[] = [];
      let crashLogFile: string | null = null;
      let crashLog: Json | null = null;
      if (kind === 'screenshot') {
        for (const [i, s] of (a.screenshots ?? []).entries()) {
          const file = join('screenshots', `${sub.id}-${i}.jpg`);
          await download(s.url, join(out, file)).catch((e) => console.error(String(e)));
          screenshotFiles.push(file);
        }
      } else {
        crashLog = await asc(`/v1/betaFeedbackCrashSubmissions/${sub.id}/crashLog`).catch(() => null);
        const text = crashLog?.data?.attributes?.logText;
        if (typeof text === 'string') {
          crashLogFile = join('crashlogs', `${sub.id}.crash`);
          writeFileSync(join(out, crashLogFile), text);
        }
      }
      raw[kind === 'screenshot' ? 'screenshots' : 'crashes'].push({ submission: sub, build, tester, crashLog });
      items.push({
        id: sub.id,
        kind,
        createdDate: a.createdDate,
        comment: a.comment ?? null,
        email: a.email ?? tester?.email ?? null,
        deviceModel: a.deviceModel ?? null,
        osVersion: a.osVersion ?? null,
        locale: a.locale ?? null,
        connectionType: a.connectionType ?? null,
        batteryPercentage: a.batteryPercentage ?? null,
        appUptimeInMilliseconds: a.appUptimeInMilliseconds ?? null,
        build: buildId
          ? { id: buildId, version: build?.version ?? null, uploadedDate: build?.uploadedDate ?? null, preRelease }
          : null,
        tester: testerId
          ? { id: testerId, firstName: tester?.firstName ?? null, lastName: tester?.lastName ?? null, email: tester?.email ?? null }
          : null,
        screenshotFiles,
        crashLogFile,
      });
    }
  }
  items.sort((x, y) => y.createdDate.localeCompare(x.createdDate));
  return { items, raw };
}

function crashSummary(file: string | null, out: string): string {
  if (!file) return '(no crash log attached)';
  const text = readFileSync(join(out, file), 'utf8');
  const keep = text
    .split('\n')
    .filter((l) => /^(Exception Type|Exception Codes|Termination Reason|Triggered by Thread|Crashed Thread)|^[0-9]+\s+\S+\s+0x/.test(l))
    .slice(0, 14);
  return keep.length ? keep.join('\n') : text.slice(0, 800);
}

function summarize(appName: string, item: Item, out: string): string {
  const who = item.tester ? [item.tester.firstName, item.tester.lastName].filter(Boolean).join(' ') || item.tester.id : 'unknown tester';
  const commit = item.build?.commit ? ` commit ${item.build.commit.slice(0, 8)}` : '';
  const head = `[${item.kind}] ${item.createdDate} ${appName} build ${item.build?.preRelease ?? '?'} (${item.build?.version ?? '?'})${commit} ${item.deviceModel ?? '?'} iOS ${item.osVersion ?? '?'}`;
  const lines = [head, `  tester: ${who}${item.email ? ` <${item.email}>` : ''}`, `  comment: ${item.comment ?? '(none)'}`];
  if (item.kind === 'crash') lines.push(...crashSummary(item.crashLogFile, out).split('\n').map((l) => `  | ${l}`));
  else lines.push(`  screenshots: ${item.screenshotFiles.join(', ') || '(none)'}`);
  return lines.join('\n');
}

// ---- build -> commit, new-item selection ----

/**
 * The workflow run that made a build. `CFBundleVersion` is `YYYYMMDDHHMM` in UTC taken when mac-build.sh starts, a
 * minute or so after the run was created: the run created in the 20 minutes before that minute (and at most a minute
 * after it) is the one.
 */
export function commitOfBuild(buildNumber: string, runs: { headSha: string; createdAt: string }[]): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(buildNumber);
  if (!m) return null;
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const hits = runs
    .map((r) => ({ sha: r.headSha, at: Date.parse(r.createdAt) }))
    .filter((r) => r.at >= at - 20 * 60_000 && r.at <= at + 60_000)
    .sort((a, b) => b.at - a.at);
  return hits[0]?.sha ?? null;
}

function releaseRuns(repo: string): { headSha: string; createdAt: string }[] {
  const out = execFileSync(
    'gh',
    ['run', 'list', '-R', repo, '--workflow', 'release-ios.yml', '--limit', '100', '--json', 'headSha,createdAt'],
    { encoding: 'utf8' },
  );
  return JSON.parse(out);
}

export type FeedbackState = { seen: string[] } | null;

/**
 * The items to act on. `all` ignores the state. With a state: the ids it has not seen. Without one (first run): items
 * created at or after `since`, or none when there is no `since` (a baseline).
 */
export function pickFresh(items: Item[], state: FeedbackState, opts: { all?: boolean; since?: string }): Item[] {
  if (opts.all) return items;
  if (state) return items.filter((i) => !state.seen.includes(i.id));
  const since = opts.since;
  return since ? items.filter((i) => i.createdDate >= since) : [];
}

// ---- Atur ----

function aturKey(): string {
  if (process.env.ATUR_API_KEY) return process.env.ATUR_API_KEY.trim();
  const file = process.env.ATUR_API_KEY_FILE ?? join(homedir(), '.config', 'atur', 'crew-api-key');
  return readFileSync(file, 'utf8').trim();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function issueTitle(appName: string, item: Item): string {
  const base = item.comment?.trim().replace(/\s+/g, ' ') || (item.kind === 'crash' ? 'crash report' : 'screenshot feedback');
  const short = base.length > 70 ? `${base.slice(0, 67)}...` : base;
  return `[TestFlight] ${appName}: ${short} (${item.id})`;
}

export function issueBody(appName: string, appId: string, item: Item, out: string): string {
  const rows = [
    ['Submission', `${item.id} (${item.kind})`],
    ['Date', item.createdDate],
    ['Build', `${item.build?.preRelease ?? '?'} (${item.build?.version ?? '?'}), uploaded ${item.build?.uploadedDate ?? '?'}${item.build?.commit ? `, commit ${item.build.commit}` : ''}`],
    ['Device', `${item.deviceModel ?? '?'}, iOS ${item.osVersion ?? '?'}, ${item.locale ?? '?'}, ${item.connectionType ?? '?'}`],
    ['Tester', item.tester ? [item.tester.firstName, item.tester.lastName].filter(Boolean).join(' ') || item.tester.id : '?'],
    ['Email', item.email ?? 'not shared'],
  ];
  const parts = [
    `<p><strong>TestFlight feedback for ${esc(appName)}</strong> (ASC app ${appId})</p>`,
    `<ul>${rows.map(([k, v]) => `<li>${k}: ${esc(String(v))}</li>`).join('')}</ul>`,
    `<p>Comment: ${esc(item.comment ?? '(none)')}</p>`,
  ];
  if (item.kind === 'crash') parts.push(`<pre>${esc(crashSummary(item.crashLogFile, out))}</pre>`);
  parts.push(
    `<p>Evidence saved locally under <code>${esc(out)}</code>; ASC: https://appstoreconnect.apple.com/apps/${appId}/testflight/feedback</p>`,
  );
  return parts.join('');
}

async function atur(method: string, path: string, body?: unknown): Promise<Json> {
  const base = (process.env.ATUR_BASE_URL ?? 'https://app.diatur.com').replace(/\/+$/, '');
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': aturKey() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`atur ${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Json;
}

async function fileAturIssue(workspace: string, project: string, title: string, html: string, id: string): Promise<string> {
  const base = `/api/workspaces/${workspace}/projects/${project}`;
  const existing = await atur('GET', `${base}/issues?q=${encodeURIComponent(id)}&limit=5`);
  const rows: Json[] = existing.results ?? [];
  if (rows.some((r) => String(r.name ?? '').includes(id))) return 'exists';
  const states = await atur('GET', `${base}/states`);
  const list: Json[] = states.results ?? [];
  const todo = list.find((s) => s.key === 'todo');
  if (!todo) throw new Error(`project ${project} has no "todo" state`);
  const created = await atur('POST', `${base}/issues`, {
    name: title,
    description_html: html,
    priority: 'medium',
    state_id: todo.id,
  });
  return `created ${created.sequence_id ?? created.id ?? ''}`.trim();
}

// ---- main ----

async function main() {
  const appId = arg('app');
  if (!appId) throw new Error('usage: testflight-feedback.ts --app <ASC app id> [--name slug] [--out dir] [--atur] [--all]');
  const name = arg('name') ?? appId;
  const out = arg('out') ?? join('tf-feedback', name);
  mkdirSync(out, { recursive: true });
  const statePath = join(out, 'state.json');
  const state: FeedbackState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;

  const { items, raw } = await collect(appId, out);
  const repo = arg('repo');
  if (repo) {
    const runs = releaseRuns(repo);
    for (const item of items) if (item.build?.version) item.build.commit = commitOfBuild(item.build.version, runs);
  }
  writeFileSync(join(out, 'submissions.json'), JSON.stringify(raw, null, 2));
  writeFileSync(join(out, 'items.json'), JSON.stringify(items, null, 2));

  const fresh = pickFresh(items, state, { all: flag('all'), since: arg('since') ?? process.env.TF_FEEDBACK_SINCE });
  const baseline = !state && !flag('all') && fresh.length === 0;
  console.log(
    `${name}: ${items.length} submissions total (${items.filter((i) => i.kind === 'screenshot').length} screenshot, ${items.filter((i) => i.kind === 'crash').length} crash), ${fresh.length} new${baseline ? ' (first run: baseline, nothing filed)' : ''}`,
  );
  for (const item of [...fresh].reverse()) console.log(`\n${summarize(name, item, out)}`);

  const done = new Set(state?.seen ?? []);
  if (!state) for (const item of items) if (!fresh.includes(item)) done.add(item.id);
  if (flag('atur') && fresh.length) {
    const workspace = arg('workspace') ?? 'joyodigitama';
    const project = arg('project') ?? process.env.ATUR_PROJECT_ID;
    if (!project) throw new Error('--atur needs --project <Atur project id> (or ATUR_PROJECT_ID)');
    for (const item of [...fresh].reverse()) {
      if (flag('dry')) {
        console.log(`\n[dry] would file: ${issueTitle(name, item)}`);
        continue;
      }
      const result = await fileAturIssue(workspace, project, issueTitle(name, item), issueBody(name, appId, item, out), item.id);
      console.log(`atur ${item.id}: ${result}`);
      done.add(item.id);
    }
  } else {
    for (const item of fresh) done.add(item.id);
  }
  if (!flag('dry')) writeFileSync(statePath, JSON.stringify({ seen: [...done] }, null, 2));
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

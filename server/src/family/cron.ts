import type { AppEnv } from "../env";
import { matchLocale, serverT } from "../i18n";
import { deliver, effectiveRules, evaluateLink } from "./alerts";
import { purgeLive } from "../live";
import { fetchRogoUsers } from "./joyorogo";
import { frozenLinkIds } from "./plan";
import { loadRules, linksOf, toLink, historyDays } from "./store";
import { DAY_MS } from "./types";

const CRON_ABSENCE = "*/15 * * * *";
const CRON_DIGEST = "0 12 * * *";
const CRON_PURGE = "0 20 * * *";
const BATCH = 300;


/** Links whose absence rules are due: runs rules 2 and 3 for each. */
export async function runAbsenceChecks(env: AppEnv, now: number): Promise<number> {
  const { results } = await env.DB.prepare("SELECT * FROM family_link WHERE status = 'active' AND next_check_at <= ?1 ORDER BY next_check_at LIMIT ?2")
    .bind(now, BATCH)
    .all<Parameters<typeof toLink>[0]>();
  const links = results.map(toLink);
  const watchers = [...new Set(links.map((l) => l.watcherId))];
  const users = await fetchRogoUsers(env, watchers, now);
  const frozen = new Set<string>();
  for (const watcherId of watchers) {
    const pro = users.get(watcherId)?.pro ?? false;
    for (const id of frozenLinkIds(await linksOf(env.DB, "watcher_id", watcherId), pro)) frozen.add(id);
  }
  for (const link of links) {
    try {
      await evaluateLink(env, link, now, { absenceOnly: true, pro: users.get(link.watcherId)?.pro ?? false, locale: matchLocale(users.get(link.watcherId)?.locale), frozen: frozen.has(link.id) });
    } catch (error) {
      console.error(JSON.stringify({ event: "family_eval_failed", link: link.id, message: error instanceof Error ? error.message : String(error) }));
    }
  }
  return links.length;
}

interface LogRow {
  id: string;
  link_id: string;
  watcher_id: string;
  rule: string;
  title: string;
  body: string;
}

/** Sends the alerts that waited out the quiet hours. */
export async function flushQueued(env: AppEnv, now: number): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, link_id, watcher_id, rule, title, body FROM family_alert_log WHERE status = 'queued' AND send_after <= ?1 LIMIT ?2")
    .bind(now, BATCH)
    .all<LogRow>();
  const users = await fetchRogoUsers(env, results.map((r) => r.watcher_id), now);
  for (const row of results) {
    const pro = users.get(row.watcher_id)?.pro ?? false;
    // Claim first: only the run that flips the status sends.
    const claimed = await env.DB.prepare("UPDATE family_alert_log SET status = 'sending' WHERE id = ?1 AND status = 'queued'").bind(row.id).run();
    if (claimed.meta.changes !== 1) continue;
    const rules = effectiveRules(await loadRules(env.DB, row.link_id), pro);
    const delivered = await deliver(env, row.watcher_id, rules, pro, matchLocale(users.get(row.watcher_id)?.locale), row.title, [row.body], { type: "family_alert", linkId: row.link_id, rule: row.rule });
    await env.DB.prepare("UPDATE family_alert_log SET status = ?2, channels = ?3 WHERE id = ?1")
      .bind(row.id, delivered.channels.length > 0 ? "sent" : "failed", delivered.channels.join(","))
      .run();
  }
  return results.length;
}

/** 19:00 WIB: one summary per Pro watcher of what waited for the digest. Free watchers have no digest. */
export async function sendDigests(env: AppEnv, now: number): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, link_id, watcher_id, rule, title, body FROM family_alert_log WHERE status = 'digest' AND at >= ?1 ORDER BY at")
    .bind(now - 36 * 3_600_000)
    .all<LogRow>();
  const byWatcher = new Map<string, LogRow[]>();
  for (const row of results) byWatcher.set(row.watcher_id, [...(byWatcher.get(row.watcher_id) ?? []), row]);
  const users = await fetchRogoUsers(env, [...byWatcher.keys()], now);
  let sent = 0;
  for (const [watcherId, rows] of byWatcher) {
    const claimed = await env.DB.batch(rows.map((r) => env.DB.prepare("UPDATE family_alert_log SET status = 'digested' WHERE id = ?1 AND status = 'digest'").bind(r.id)));
    if (claimed.every((c) => c.meta.changes !== 1)) continue;
    const pro = users.get(watcherId)?.pro ?? false;
    if (!pro) continue;
    const rules = effectiveRules(await loadRules(env.DB, rows[0]!.link_id), pro);
    const lines = rows.map((r) => r.body);
    const locale = matchLocale(users.get(watcherId)?.locale);
    const delivered = await deliver(env, watcherId, rules, pro, locale, serverT(locale)("push:family.digest.title"), lines, { type: "family_digest", linkId: rows[0]!.link_id, rule: "digest" });
    if (delivered.channels.length > 0) sent += 1;
  }
  return sent;
}

/** Drops history past what a plan keeps: 90 days when any live watcher is Pro, else 30; old log rows and invites too; live tracking sessions 24 h after their last point or end. */
export async function purge(env: AppEnv, now: number): Promise<void> {
  // First: it needs no JoyoRogo answer, so an outage below cannot keep location data past its 24 h.
  await purgeLive(env.DB, now);
  const dayStr = (daysAgo: number) => new Date(now - daysAgo * DAY_MS).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM family_day WHERE date < ?1").bind(dayStr(historyDays(true))).run();
  const { results } = await env.DB.prepare("SELECT monitored_id, watcher_id FROM family_link WHERE status = 'active'").all<{ monitored_id: string; watcher_id: string }>();
  const watchersOf = new Map<string, string[]>();
  for (const row of results) watchersOf.set(row.monitored_id, [...(watchersOf.get(row.monitored_id) ?? []), row.watcher_id]);
  const users = await fetchRogoUsers(env, [...new Set(results.map((r) => r.watcher_id))], now);
  for (const [monitoredId, watchers] of watchersOf) {
    if (watchers.some((id) => users.get(id)?.pro)) continue;
    // Only when JoyoRogo answered for every watcher: an outage must not shorten anyone's history.
    if (!watchers.every((id) => users.has(id))) continue;
    await env.DB.prepare("DELETE FROM family_day WHERE user_id = ?1 AND date < ?2").bind(monitoredId, dayStr(historyDays(false))).run();
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM family_alert_log WHERE at < ?1").bind(now - 90 * DAY_MS),
    env.DB.prepare("DELETE FROM family_invite WHERE expires_at < ?1").bind(now - DAY_MS),
  ]);
}

/** The Worker's `scheduled` handler: dispatches on the trigger's cron expression. */
export async function runScheduled(env: AppEnv, cron: string, now: number = Date.now()): Promise<void> {
  if (cron === CRON_ABSENCE) {
    await runAbsenceChecks(env, now);
    await flushQueued(env, now);
  } else if (cron === CRON_DIGEST) await sendDigests(env, now);
  else if (cron === CRON_PURGE) await purge(env, now);
}

export const CRONS = [CRON_ABSENCE, CRON_DIGEST, CRON_PURGE] as const;

/** After an ingest: runs every rule for each live link of the monitored person. */
export async function evaluateOnIngest(env: AppEnv, monitoredId: string, now: number): Promise<void> {
  const links = (await linksOf(env.DB, "monitored_id", monitoredId)).filter((l) => l.status === "active");
  const users = await fetchRogoUsers(env, links.map((l) => l.watcherId), now);
  for (const link of links) {
    try {
      const pro = users.get(link.watcherId)?.pro ?? false;
      const frozen = frozenLinkIds(await linksOf(env.DB, "watcher_id", link.watcherId), pro).has(link.id);
      await evaluateLink(env, link, now, { pro, locale: matchLocale(users.get(link.watcherId)?.locale), frozen });
    } catch (error) {
      console.error(JSON.stringify({ event: "family_eval_failed", link: link.id, message: error instanceof Error ? error.message : String(error) }));
    }
  }
}

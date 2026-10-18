import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Screen';
import { authClient } from '@/cloud/auth';
import { fmtInt } from '@/i18n/format';
import { spacing, useColors } from '@/theme';

import {
  ROGO_IMPORT_DISMISSED_META,
  ROGO_IMPORT_META,
  importRogoStrength,
  probeRogoImport,
  type RogoImportDismissal,
  type RogoImportResult,
} from '../importRogo';
import { getStrengthMeta, setStrengthMeta } from '../store';

const ASK_AGAIN_MS = 30 * 24 * 3600_000;

type Phase =
  | { kind: 'hidden' }
  | { kind: 'offer'; sessions: number; routines: number; menu: boolean }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'error'; sessions: number; routines: number }
  | { kind: 'done'; result: RogoImportResult };

function parseDismissal(raw: string | null): RogoImportDismissal | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RogoImportDismissal>;
    return typeof value.at === 'number' ? { at: value.at, forever: value.forever === true } : null;
  } catch {
    return null;
  }
}

/**
 * Offers to bring the person's JoyoRogo strength history, routines and custom exercises into JoyoFit. Renders nothing unless
 * signed in to JoyoRogo, not imported yet, not dismissed, and JoyoRogo has something. Checked once per focus.
 */
export function RogoImportCard(): ReactElement | null {
  const db = useSQLiteContext();
  const colors = useColors();
  const { t } = useTranslation('routines');
  const [phase, setPhase] = useState<Phase>({ kind: 'hidden' });
  const busy = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (busy.current) return undefined;
      let cancelled = false;
      void (async () => {
        try {
          if (!(await authClient.getCookie())) return;
          if (await getStrengthMeta(db, ROGO_IMPORT_META)) return;
          const dismissal = parseDismissal(await getStrengthMeta(db, ROGO_IMPORT_DISMISSED_META));
          if (dismissal && (dismissal.forever || Date.now() - dismissal.at < ASK_AGAIN_MS)) return;
          const found = await probeRogoImport();
          if (cancelled || busy.current || !found || found.sessions + found.routines === 0) return;
          setPhase({ kind: 'offer', ...found, menu: false });
        } catch {
          // Offline, signed out or a server hiccup: no card now, the next focus asks again.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [db]),
  );

  const run = useCallback(
    async (sessions: number, routines: number) => {
      busy.current = true;
      setPhase({ kind: 'importing', done: 0, total: sessions + routines });
      try {
        const result = await importRogoStrength(db, {
          onProgress: (done, total) => setPhase({ kind: 'importing', done, total }),
        });
        if (result.unavailable) {
          busy.current = false;
          setPhase({ kind: 'hidden' });
          return;
        }
        setPhase({ kind: 'done', result });
      } catch {
        busy.current = false;
        setPhase({ kind: 'error', sessions, routines });
      }
    },
    [db],
  );

  const dismiss = useCallback(
    async (forever: boolean) => {
      setPhase({ kind: 'hidden' });
      const value: RogoImportDismissal = { at: Date.now(), forever };
      await setStrengthMeta(db, ROGO_IMPORT_DISMISSED_META, JSON.stringify(value)).catch(() => undefined);
    },
    [db],
  );

  if (phase.kind === 'hidden') return null;

  return (
    <Card>
      <View style={styles.body}>
        <AppText variant="bodyStrong">{phase.kind === 'done' ? t('import.success.title') : t('import.title')}</AppText>

        {phase.kind === 'offer' || phase.kind === 'error' ? (
          <>
            <AppText variant="body">
              {phase.sessions > 0
                ? t('import.offer', { count: phase.sessions })
                : t('import.offerRoutines', { count: phase.routines })}
            </AppText>
            {phase.kind === 'error' ? (
              <AppText variant="caption" danger>
                {t('import.error')}
              </AppText>
            ) : (
              <AppText variant="caption" muted>
                {t('import.note')}
              </AppText>
            )}
          </>
        ) : null}

        {phase.kind === 'importing' ? (
          <>
            <View style={[styles.track, { backgroundColor: colors.muted }]}>
              <View
                style={[
                  styles.fill,
                  { backgroundColor: colors.primary, width: `${phase.total > 0 ? Math.min(100, Math.round((phase.done / phase.total) * 100)) : 0}%` },
                ]}
              />
            </View>
            <AppText variant="caption" muted>
              {phase.total > 0
                ? t('import.progress', { done: fmtInt(phase.done), total: fmtInt(phase.total) })
                : t('import.progressUnknown', { done: fmtInt(phase.done) })}
            </AppText>
          </>
        ) : null}

        {phase.kind === 'done' ? (
          <AppText variant="body">
            {t('import.success.body', { workouts: fmtInt(phase.result.workouts), routines: fmtInt(phase.result.routines) })}
          </AppText>
        ) : null}

        <View style={styles.actions}>
          {phase.kind === 'offer' && !phase.menu ? (
            <>
              <Button label={t('import.action.import')} variant="primary" icon="download" onPress={() => void run(phase.sessions, phase.routines)} />
              <Button label={t('import.action.notNow')} variant="ghost" onPress={() => setPhase({ ...phase, menu: true })} />
            </>
          ) : null}
          {phase.kind === 'offer' && phase.menu ? (
            <>
              <Button label={t('import.action.askLater')} onPress={() => void dismiss(false)} />
              <Button label={t('import.action.never')} variant="ghost" onPress={() => void dismiss(true)} />
            </>
          ) : null}
          {phase.kind === 'error' ? (
            <Button label={t('import.action.retry')} variant="primary" icon="refresh" onPress={() => void run(phase.sessions, phase.routines)} />
          ) : null}
          {phase.kind === 'done' ? (
            <Button
              label={t('import.action.done')}
              variant="primary"
              onPress={() => {
                busy.current = false;
                setPhase({ kind: 'hidden' });
              }}
            />
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});

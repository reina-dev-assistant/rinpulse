import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { useCoach } from '@/features/coach/useCoach';
import { useNightHrvAvailability } from '@/features/today/useNightHrvAvailability';
import { fmtInt, useLocale } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';
import { previewDigest } from '../engine';
import { aiNotes } from '../stores';
import { TOOL_NAMES } from '../tools';

/** The digest is sent as compact JSON at about this many characters per token. */
const CHARS_PER_TOKEN = 3.5;

/** "Data yang dikirim": the digest as it would go to the provider with the next question, built from the phone now, with what else the AI can read and what never leaves. */
export function DataScreen() {
  const { t } = useTranslation('ai');
  useLocale();
  const router = useRouter();
  const colors = useColors();
  const db = useSQLiteContext();
  const cloud = useCloud();
  const { dataVersion } = useWatch();
  const availability = useNightHrvAvailability(dataVersion);
  const coach = useCoach(dataVersion, availability);
  const coachRef = useRef(coach);
  useEffect(() => {
    coachRef.current = coach;
  });
  const ready = coach !== null;
  const [sent, setSent] = useState<{ json: string; pretty: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const current = coachRef.current;
    if (!current) return;
    let cancelled = false;
    setFailed(false);
    previewDigest(db, current, cloud.signedIn)
      .then((result) => {
        if (!cancelled) setSent({ json: result.json, pretty: JSON.stringify(JSON.parse(result.json), null, 1) });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, db, cloud.signedIn, nonce]);

  const reload = () => {
    setSent(null);
    setNonce((n) => n + 1);
  };
  const noteCount = aiNotes.list().length;

  return (
    <Screen>
      <AppText variant="caption" muted>
        {t('data.intro')}
      </AppText>

      {!ready ? (
        <>
          <Skeleton width="100%" height={200} radius="card" />
          <AppText variant="caption" muted>
            {t('data.notReady')}
          </AppText>
        </>
      ) : null}
      {failed ? (
        <Notice tone="danger" action={{ label: t('data.reload'), onPress: reload }}>
          {t('data.failed')}
        </Notice>
      ) : null}
      {ready && !failed && !sent ? <Skeleton width="100%" height={200} radius="card" /> : null}
      {sent ? (
        <Section title={t('data.jsonTitle')} icon="code-slash" tint="link">
          <AppText variant="caption" muted>
            {t('data.size', { chars: fmtInt(sent.json.length), tokens: fmtInt(sent.json.length / CHARS_PER_TOKEN) })}
          </AppText>
          <View style={[styles.json, { backgroundColor: colors.muted }]}>
            <AppText variant="mono" selectable>
              {sent.pretty}
            </AppText>
          </View>
          {cloud.signedIn ? null : <Notice icon="restaurant">{t('data.signedOut')}</Notice>}
          <Button label={t('data.reload')} variant="ghost" icon="refresh" onPress={reload} />
        </Section>
      ) : null}

      <Section title={t('data.notesTitle')} icon="document-text" tint="link">
        <AppText variant="caption" muted>
          {t('data.notesLine', { n: fmtInt(noteCount) })}
        </AppText>
        <Button label={t('data.notesOpen')} icon="document-text" onPress={() => router.push('/settings/ai-notes')} />
      </Section>

      <Section title={t('data.toolsTitle')} icon="search" tint="link">
        <AppText variant="caption" muted>
          {t('data.toolsIntro')}
        </AppText>
        {TOOL_NAMES.map((name) => (
          <AppText key={name} variant="caption">
            {`\u2022 ${t(`data.tools.${name}`)}`}
          </AppText>
        ))}
      </Section>

      <Section title={t('consent.notSentTitle')} icon="shield-checkmark" tint="link">
        <AppText variant="caption" muted>
          {t('consent.notSent')}
        </AppText>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  json: { borderRadius: 12, padding: spacing.md },
});

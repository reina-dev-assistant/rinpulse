import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BrandMark } from '@/components/BrandMark';
import { IconChip } from '@/components/IconChip';
import { NavRow } from '@/components/NavRow';
import { PressableScale } from '@/components/PressableScale';
import { Card, Screen } from '@/components/Screen';
import { Skeleton } from '@/components/States';
import { sourceRows, splitSources, type SourceId, type SourceRow, type SourceState } from '@/features/sources/model';
import { HEALTH_STORE } from '@/features/sources/store';
import { useSourceFacts } from '@/features/sources/useSourceFacts';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';
import { HuaweiWear } from '@/wear';

const DESTINATION: Record<SourceId, Href> = {
  watch: '/watch',
  health: '/settings/health',
  strava: '/settings/strava',
  joyorogo: '/settings/joyorogo',
  scale: '/settings/scale',
};

function Mark({ id }: { id: SourceId }) {
  switch (id) {
    case 'watch':
      return <IconChip icon="watch" size="md" />;
    case 'health':
      return <BrandMark brand={HEALTH_STORE === 'Apple Health' ? 'apple-health' : 'health-connect'} />;
    case 'strava':
      return <BrandMark brand="strava" />;
    case 'joyorogo':
      return <IconChip icon="restaurant" tint="link" size="md" />;
    case 'scale':
      return <IconChip icon="scale-outline" size="md" />;
  }
}

function useStateColor() {
  const colors = useColors();
  return (state: SourceState) => (state === 'on' ? colors.linkText : state === 'attention' ? colors.warning : colors.mutedForeground);
}

/** One source: its mark and name, whether it is working, then channel, last movement, what it carried and the one thing to look at. */
function SourceItem({ row, first, onPress }: { row: SourceRow; first: boolean; onPress: () => void }) {
  const colors = useColors();
  const { t } = useTranslation('settings');
  const stateColor = useStateColor();
  const lines = [row.via, row.last, row.counts].filter((l): l is string => l !== null);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={[row.title, t(`sources.state.${row.state}`), ...lines, row.note].filter(Boolean).join('. ')}
      onPress={onPress}
      scaleTo={0.985}
      style={[styles.item, first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline }]}>
      <View style={styles.mark}>
        <Mark id={row.id} />
      </View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <AppText variant="bodyStrong" numberOfLines={1} style={styles.title}>
            {row.title}
          </AppText>
          <AppText variant="label" color={stateColor(row.state)}>
            {t(`sources.state.${row.state}`)}
          </AppText>
        </View>
        {lines.map((line, i) => (
          <AppText key={i} variant="caption" muted>
            {line}
          </AppText>
        ))}
        {row.note ? (
          <AppText variant="caption" color={row.state === 'attention' ? colors.warning : colors.mutedForeground}>
            {row.note}
          </AppText>
        ) : null}
      </View>
    </PressableScale>
  );
}

/**
 * More > Sources & connections: every place JoyoFit's data comes from or goes to in one list. Each row says through what (`via`), when
 * it last moved and what it carried in the last 7 days, and opens its own screen; the system permission screen of the health store is one
 * row away. The deep screens stay where they were; this is the entry list with the status the flat list never had.
 */
export function SourcesScreen() {
  const { t } = useTranslation('settings');
  const router = useRouter();
  const { linkState, device, sync } = useWatch();
  const { facts, health } = useSourceFacts();
  const canSync = linkState === 'connected' && device !== null;
  const rows = facts ? sourceRows(facts) : null;
  const { connected, available } = rows ? splitSources(rows) : { connected: [], available: [] };

  return (
    <Screen refresh={{ refreshing: linkState === 'syncing', onRefresh: () => void sync(), enabled: canSync }}>
      <AppText variant="caption" muted>
        {t('sources.lead')}
      </AppText>
      {!rows ? (
        <Skeleton width="100%" height={320} radius="card" />
      ) : (
        <>
          {connected.length > 0 ? (
            <View style={styles.group}>
              <AppText variant="heading" accessibilityRole="header">
                {t('sources.connected')}
              </AppText>
              <Card style={styles.card}>
                {connected.map((row, i) => (
                  <SourceItem key={row.id} row={row} first={i === 0} onPress={() => router.push(DESTINATION[row.id])} />
                ))}
              </Card>
            </View>
          ) : null}
          {available.length > 0 ? (
            <View style={styles.group}>
              <AppText variant="heading" accessibilityRole="header">
                {t('sources.available')}
              </AppText>
              <Card style={styles.card}>
                {available.map((row, i) => (
                  <SourceItem key={row.id} row={row} first={i === 0} onPress={() => router.push(DESTINATION[row.id])} />
                ))}
              </Card>
            </View>
          ) : null}
          {health?.availability === 'available' ? (
            <View style={styles.group}>
              <AppText variant="heading" accessibilityRole="header">
                {t('sources.permissions')}
              </AppText>
              <Card style={styles.card}>
                <NavRow
                  icon="lock-closed-outline"
                  title={t('sources.manage', { store: HEALTH_STORE })}
                  subtitle={t('sources.manageSubtitle')}
                  onPress={() => void HuaweiWear.openHealthConnectSettings().catch(() => undefined)}
                />
              </Card>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  card: { padding: 0, gap: 0, overflow: 'hidden' },
  item: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md + 4, alignItems: 'flex-start' },
  mark: { width: 40, alignItems: 'center', paddingTop: 2 },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1 },
});

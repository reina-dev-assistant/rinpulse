import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Details } from '@/components/Details';
import { IconChip } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { Card, Screen, Section } from '@/components/Screen';
import { EmptyState, Skeleton } from '@/components/States';
import { gearKm } from '@/features/gear/format';
import { GEAR_SPORTS, gearChoices, type Gear, type GearKind, type GearNotified, type GearSport, type GearTotals } from '@/features/gear/model';
import { dismissReminder, reminderPending, setDefault } from '@/features/gear/store';
import { useGear } from '@/features/gear/useGear';
import { GearReminderCard } from '@/features/gear/ui/GearReminderCard';
import { fmtDistance, fmtDuration } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { spacing, useTheme } from '@/theme';

const KIND_ICON = { shoes: 'footsteps', bike: 'bicycle', other: 'cube-outline' } as const satisfies Record<GearKind, string>;
const PHOTO = 56;

/** Settings → Gear: every shoe and bike with its lifetime distance, the default per sport, and the add button. */
export default function GearScreen() {
  const { t } = useTranslation('gear');
  const db = useSQLiteContext();
  const router = useRouter();
  const cloud = useCloud();
  const { gear, totals, defaults, ready, reload } = useGear();

  const afterChange = useCallback(async () => {
    await reload().catch(() => {});
    if (cloud.signedIn) void cloud.syncNow().catch(() => {});
  }, [reload, cloud]);

  const defaultGearIds = useMemo(() => new Set(defaults.flatMap((d) => (d.gearId ? [d.gearId] : []))), [defaults]);
  const active = gear.filter((g) => g.retiredAt === null);
  const retired = gear.filter((g) => g.retiredAt !== null);

  const open = (id: string) => router.push({ pathname: '/settings/gear-edit', params: { id } });
  const renderCard = (g: Gear) => (
    <GearCard
      key={g.id}
      gear={g}
      totals={totals.get(g.id)}
      isDefault={defaultGearIds.has(g.id)}
      onOpen={() => open(g.id)}
      onDismiss={async (level) => {
        await dismissReminder(db, g.id, level);
        await afterChange();
      }}
    />
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('title') }} />
      {!ready ? (
        <Skeleton width="100%" height={120} radius={16} />
      ) : gear.length === 0 ? (
        <Card>
          <EmptyState
            icon="footsteps"
            title={t('list.empty.title')}
            description={t('list.empty.body')}
            action={{ label: t('list.add'), icon: 'add', onPress: () => router.push('/settings/gear-edit') }}
          />
        </Card>
      ) : (
        <>
          {active.map(renderCard)}
          {retired.length > 0 ? (
            <Section title={t('list.retiredHeading')} icon="archive-outline">
              <View style={styles.retired}>{retired.map(renderCard)}</View>
            </Section>
          ) : null}
          <Button label={t('list.add')} icon="add" variant="primary" onPress={() => router.push('/settings/gear-edit')} />

          <Section title={t('defaults.title')} icon="star-outline">
            <AppText variant="caption" muted>
              {t('defaults.hint')}
            </AppText>
            {GEAR_SPORTS.map((sport) => (
              <DefaultRow
                key={sport}
                sport={sport}
                choices={gearChoices(gear, sport).filter((g) => g.retiredAt === null)}
                selectedId={defaults.find((d) => d.sport === sport)?.gearId ?? null}
                onPick={async (gearId) => {
                  await setDefault(db, sport, gearId);
                  await afterChange();
                }}
              />
            ))}
          </Section>
        </>
      )}
      <Details>{t('intro')}</Details>
    </Screen>
  );
}

interface CardProps {
  gear: Gear;
  totals: GearTotals | undefined;
  isDefault: boolean;
  onOpen: () => void;
  onDismiss: (level: GearNotified) => Promise<void>;
}

function GearCard({ gear, totals, isDefault, onOpen, onDismiss }: CardProps) {
  const { t } = useTranslation('gear');
  const { colors, fonts, radius } = useTheme();
  const distanceM = totals?.distanceM ?? gear.startDistanceM;
  const pending = reminderPending(gear, distanceM);
  const subtitle = [gear.brand, gear.model].filter(Boolean).join(' · ');
  const share = gear.retireAtM && gear.retireAtM > 0 ? Math.min(distanceM / gear.retireAtM, 1) : null;
  const usage = t('list.usage', {
    count: totals?.workouts ?? 0,
    distance: fmtDistance(distanceM),
    time: fmtDuration(totals?.seconds ?? 0),
  });

  return (
    <Card style={styles.card}>
      <PressableScale accessibilityRole="button" accessibilityLabel={gear.name} onPress={onOpen} scaleTo={0.985} style={styles.tap}>
        <View style={styles.head}>
          {gear.photoUri ? (
            <Image source={{ uri: gear.photoUri }} style={[styles.photo, { backgroundColor: colors.muted }]} accessibilityIgnoresInvertColors />
          ) : (
            <IconChip icon={KIND_ICON[gear.kind]} size="lg" />
          )}
          <View style={styles.titles}>
            <AppText variant="heading" numberOfLines={1}>
              {gear.name}
            </AppText>
            {subtitle ? (
              <AppText variant="caption" muted numberOfLines={1}>
                {subtitle}
              </AppText>
            ) : null}
            <View style={styles.badges}>
              <View style={[styles.badge, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
                <AppText variant="label">{t(`kinds.${gear.kind}`)}</AppText>
              </View>
              {isDefault ? (
                <View style={[styles.badge, { backgroundColor: colors.primary, borderRadius: radius.control }]}>
                  <AppText variant="label" color={colors.primaryForeground} style={{ fontFamily: fonts.medium }}>
                    {t('list.default')}
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </View>
        <AppText variant="caption" muted>
          {usage}
        </AppText>
        {share !== null && gear.retireAtM ? (
          <View style={styles.progress}>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}
              style={[styles.track, { backgroundColor: colors.muted }]}>
              <View
                style={[styles.fill, { width: `${Math.round(share * 100)}%`, backgroundColor: share >= 1 ? colors.destructive : colors.primary }]}
              />
            </View>
            <AppText variant="caption" muted>
              {t('list.progress', { distance: gearKm(distanceM), limit: gearKm(gear.retireAtM) })}
            </AppText>
          </View>
        ) : (
          <AppText variant="caption" muted>
            {t('list.noLimit')}
          </AppText>
        )}
      </PressableScale>
      {pending > 0 ? <GearReminderCard gear={gear} distanceM={distanceM} onDismiss={() => void onDismiss(pending)} /> : null}
    </Card>
  );
}

interface DefaultRowProps {
  sport: GearSport;
  choices: Gear[];
  selectedId: string | null;
  onPick: (gearId: string | null) => Promise<void>;
}

function DefaultRow({ sport, choices, selectedId, onPick }: DefaultRowProps) {
  const { t } = useTranslation('gear');
  const none = selectedId === null || !choices.some((g) => g.id === selectedId);
  return (
    <View style={styles.defaultRow}>
      <AppText variant="label" muted>
        {t(`sports.${sport}`)}
      </AppText>
      <View style={styles.chips}>
        <Chip label={t('defaults.none')} selected={none} onPress={() => void onPick(null)} />
        {choices.map((g) => (
          <Chip key={g.id} label={g.name} selected={!none && g.id === selectedId} onPress={() => void onPick(g.id)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  tap: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photo: { width: PHOTO, height: PHOTO, borderRadius: 12 },
  titles: { flex: 1, gap: 2 },
  badges: { flexDirection: 'row', gap: spacing.xs, paddingTop: spacing.xs },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2 },
  progress: { gap: 6 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  retired: { gap: spacing.md },
  defaultRow: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

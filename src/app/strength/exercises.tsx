import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { Input } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { useContentPadding } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { EmptyState, Skeleton } from '@/components/States';
import { exercisesUsed } from '@/features/strength/calc';
import { normalize } from '@/features/strength/catalog';
import { useStrengthHistory } from '@/features/strength/history';
import { fmtDate, useLocale } from '@/i18n';
import { spacing, useColors, useTheme } from '@/theme';

type Tab = 'done' | 'all';

interface Row {
  id: string;
  name: string;
  subtitle: string;
  custom: boolean;
}

export default function StrengthExercisesScreen() {
  const { t } = useTranslation(['lifts', 'coach']);
  const router = useRouter();
  const colors = useColors();
  const locale = useLocale();
  const padding = useContentPadding(false);
  const { ready, workouts, catalog } = useStrengthHistory();
  const [tab, setTab] = useState<Tab | null>(null);
  const [query, setQuery] = useState('');

  const used = useMemo(() => exercisesUsed(workouts), [workouts]);
  // The first look opens on what the person did; with no history it opens on the library.
  const shown: Tab = tab ?? (used.length > 0 ? 'done' : 'all');

  const rows = useMemo<Row[]>(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    const removed = t('exercises.removed');
    const matches = (name: string) => {
      const folded = normalize(name);
      return words.every((w) => folded.includes(w));
    };
    if (shown === 'done') {
      return used
        .map((u) => {
          const exercise = catalog.get(u.exerciseId);
          const name = catalog.name(u.exerciseId, locale) ?? removed;
          return {
            id: u.exerciseId,
            name,
            custom: exercise?.custom ?? false,
            subtitle: t('exercises.usedLine', { count: u.workouts, date: fmtDate(u.lastAt / 1000, 'medium') }),
            // Both languages are searched: gym talk mixes them.
            haystack: exercise ? `${exercise.name.id} ${exercise.name.en}` : name,
          };
        })
        .filter((r) => matches(r.haystack))
        .map(({ haystack: _haystack, ...row }) => row);
    }
    return catalog.search({ query }, locale).map((e) => ({
      id: e.id,
      name: e.name[locale],
      custom: e.custom,
      subtitle: e.primary.map((m) => t(`coach:muscle.${m}`)).join(', '),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, used, catalog, query, locale, t]);

  const open = useCallback((id: string) => router.push({ pathname: '/strength/exercise/[id]', params: { id } }), [router]);

  const options = useMemo(
    () => [
      { value: 'done' as const, label: t('exercises.tab.done') },
      { value: 'all' as const, label: t('exercises.tab.all') },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('exercises.title') }} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={padding}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        initialNumToRender={14}
        windowSize={9}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          <View style={styles.header}>
            <Segmented options={options} value={shown} onChange={setTab} />
            <Input
              icon="search"
              accessibilityLabel={t('exercises.searchLabel')}
              placeholder={t('exercises.searchPlaceholder')}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
        }
        ListEmptyComponent={
          !ready ? (
            <View style={styles.skeletons}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} width="100%" height={64} radius="card" />
              ))}
            </View>
          ) : shown === 'done' && query.trim() === '' ? (
            <EmptyState
              icon="barbell"
              title={t('exercises.emptyDone.title')}
              description={t('exercises.emptyDone.description')}
              action={{ label: t('exercises.emptyDone.browse'), icon: 'search', onPress: () => setTab('all') }}
            />
          ) : (
            <EmptyState icon="search" title={t('exercises.noMatch.title')} description={t('exercises.noMatch.description')} />
          )
        }
        renderItem={({ item }) => <ExerciseRow row={item} onPress={open} />}
      />
    </View>
  );
}

function ExerciseRow({ row, onPress }: { row: Row; onPress: (id: string) => void }) {
  const { colors, radius } = useTheme();
  const { t } = useTranslation('lifts');
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={row.subtitle ? t('exercises.rowA11y', { name: row.name, detail: row.subtitle }) : row.name}
      onPress={() => onPress(row.id)}
      style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.card }]}>
      <IconChip icon={row.custom ? 'person' : 'barbell'} tint={row.custom ? 'link' : 'workouts'} />
      <View style={styles.rowText}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {row.name}
        </AppText>
        {row.subtitle ? (
          <AppText variant="caption" muted numberOfLines={1}>
            {row.subtitle}
          </AppText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
    </PressableScale>
  );
}

function Separator() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { gap: spacing.md, marginBottom: spacing.md },
  skeletons: { gap: spacing.sm },
  gap: { height: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 64 },
  rowText: { flex: 1, gap: 2 },
});

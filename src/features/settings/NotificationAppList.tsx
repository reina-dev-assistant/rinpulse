import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { FlatList, Image, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { Details } from '@/components/Details';
import { isIos } from '@/components/IosUnavailable';
import { Field } from '@/components/Input';
import { groupedRowStyle } from '@/components/NavRow';
import { useContentPadding } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { errorMessage } from '@/format';
import { NotificationAppListIos } from '@/features/settings/NotificationAppListIos';
import { spacing, useTheme } from '@/theme';
import { HuaweiWear, type NotificationApp } from '@/wear';

const ROW_HEIGHT = 64;
const SKELETON_ROWS = 8;
const ICON_SIZE = 32;

/** The app's icon, or a neutral circle with a glyph when it is missing or fails to load. */
function AppIcon({ uri }: { uri?: string | null }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  if (uri && !failed) {
    return (
      <Image
        accessible={false}
        source={{ uri }}
        onError={() => setFailed(true)}
        style={styles.icon}
        fadeDuration={0}
      />
    );
  }
  return (
    <View accessible={false} style={[styles.icon, styles.iconPlaceholder, { backgroundColor: colors.muted }]}>
      <Ionicons name="apps" size={18} color={colors.mutedForeground} />
    </View>
  );
}

/** Per-app forwarding switches: searchable, windowed, with a sticky header. Loads the apps once. */
export function NotificationAppList() {
  return isIos ? <NotificationAppListIos /> : <NotificationAppListAndroid />;
}

function NotificationAppListAndroid() {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const { colors } = theme;
  const padding = useContentPadding(false);
  const [apps, setApps] = useState<NotificationApp[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Apps that were on when "Enabled first" was turned on. Frozen so rows do not jump while toggling.
  const [pinned, setPinned] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    let live = true;
    HuaweiWear.getNotificationApps().then(
      (list) => {
        if (live) setApps(list);
      },
      (e) => {
        if (live) setError(errorMessage(e));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const visible = useMemo(() => {
    if (!apps) return [];
    const needle = filter.trim().toLowerCase();
    const matching = needle
      ? apps.filter(
          (app) =>
            app.label.toLowerCase().includes(needle) ||
            app.packageName.toLowerCase().includes(needle),
        )
      : apps;
    if (!pinned) return matching;
    return [
      ...matching.filter((app) => pinned.has(app.packageName)),
      ...matching.filter((app) => !pinned.has(app.packageName)),
    ];
  }, [apps, filter, pinned]);

  const enabledCount = useMemo(() => apps?.filter((app) => app.enabled).length ?? 0, [apps]);

  const setEnabled = async (packageName: string, enabled: boolean) => {
    setError(null);
    const update = (value: boolean) =>
      setApps((list) =>
        list ? list.map((a) => (a.packageName === packageName ? { ...a, enabled: value } : a)) : list,
      );
    update(enabled);
    try {
      await HuaweiWear.setNotificationAppEnabled(packageName, enabled);
    } catch (e) {
      update(!enabled);
      setError(errorMessage(e));
    }
  };

  const toggleEnabledFirst = () =>
    setPinned(
      pinned || !apps ? null : new Set(apps.filter((app) => app.enabled).map((app) => app.packageName)),
    );

  const getItemLayout = useCallback(
    (_: ArrayLike<NotificationApp> | null | undefined, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  const header = (
    <View style={[styles.header, { backgroundColor: colors.background }]}>
      <Field
        label={t('notifApps.filter')}
        icon="search"
        value={filter}
        onChangeText={setFilter}
        placeholder={t('notifApps.filter')}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <View style={styles.headerRow}>
        <Chip label={t('notifApps.enabledFirst')} role="checkbox" selected={pinned !== null} onPress={toggleEnabledFirst} />
        <AppText variant="caption" muted>
          {apps ? t('notifApps.onCount', { enabled: enabledCount, total: apps.length }) : ''}
        </AppText>
      </View>
      <Details>{t('notifApps.hint')}</Details>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </View>
  );

  return (
    <FlatList
      data={visible}
      keyExtractor={(app) => app.packageName}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={padding}
      keyboardShouldPersistTaps="handled"
      stickyHeaderIndices={[0]}
      ListHeaderComponent={header}
      getItemLayout={getItemLayout}
      initialNumToRender={14}
      maxToRenderPerBatch={14}
      windowSize={9}
      removeClippedSubviews
      renderItem={({ item, index }) => (
        <View style={[styles.row, groupedRowStyle(theme, index, visible.length)]}>
          <AppIcon uri={item.iconUri} />
          <View style={styles.text}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {item.label}
            </AppText>
            <AppText variant="caption" muted numberOfLines={1}>
              {item.packageName}
            </AppText>
          </View>
          <Switch
            accessibilityLabel={item.label}
            value={item.enabled}
            onValueChange={(enabled) => setEnabled(item.packageName, enabled)}
            trackColor={{ false: colors.switchOff, true: colors.primary }}
            thumbColor={item.enabled ? colors.primaryForeground : colors.card}
          />
        </View>
      )}
      ListEmptyComponent={
        apps === null && !error ? (
          <View accessibilityLabel={t('notifApps.loading')}>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <View key={i} style={[styles.row, groupedRowStyle(theme, i, SKELETON_ROWS)]}>
                <Skeleton width={40} height={40} radius={20} />
                <View style={styles.text}>
                  <Skeleton width="55%" height={14} />
                  <Skeleton width="80%" height={10} />
                </View>
              </View>
            ))}
          </View>
        ) : apps !== null ? (
          <EmptyState
            icon="search"
            title={t('notifApps.noMatchTitle')}
            description={filter.trim() ? t('notifApps.noMatch', { query: filter.trim() }) : t('notifApps.noApps')}
            action={filter ? { label: t('notifApps.clear'), onPress: () => setFilter('') } : undefined}
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, paddingBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  icon: { width: ICON_SIZE, height: ICON_SIZE, borderRadius: ICON_SIZE / 2 },
  iconPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});

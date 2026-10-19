import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, BackHandler, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ANDROID_PACKAGE, NATIVE_BUILD, openFirst } from '@/features/updates/forceUpdate';
import { storeTargets } from '@/features/updates/forceUpdatePolicy';
import { useUpdateGate } from '@/features/updates/UpdateGateProvider';
import { spacing, useTheme } from '@/theme';

/**
 * Full-screen "Update dulu" wall (docs/force-update.md): this build is older than the server's minimum. Explains why,
 * opens the store (Play, TestFlight or App Store) and re-checks on "Cek lagi". Renders nothing unless the gate says
 * block. Mounted as the whole app on a blocked cold start and as an opaque cover on a block found at resume.
 */
export function UpdateRequiredScreen({ cover }: { cover: boolean }) {
  const { decision } = useUpdateGate();
  if (decision.kind !== 'block') return null;
  return <Wall storeUrl={decision.storeUrl} message={decision.message} cover={cover} />;
}

function Wall({ storeUrl, message, cover }: { storeUrl: string; message: string | null; cover: boolean }) {
  const { t } = useTranslation('settings');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { recheck, checking } = useUpdateGate();
  const [openFailed, setOpenFailed] = useState(false);
  const [stillOld, setStillOld] = useState(false);
  const targets = storeTargets(Platform.OS, storeUrl, ANDROID_PACKAGE);

  // Android back must not slip past the wall.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const primaryLabel =
    targets.kind === 'play'
      ? t('updates.gate.openPlay')
      : targets.kind === 'testflight'
        ? t('updates.gate.openTestFlight')
        : targets.kind === 'appstore'
          ? t('updates.gate.openAppStore')
          : t('updates.gate.openWeb');

  const open = async (urls: string[]) => {
    setOpenFailed(!(await openFirst(urls)));
  };

  const check = async () => {
    setStillOld(false);
    const next = await recheck();
    if (next.kind === 'block') setStillOld(true);
  };

  return (
    <View
      accessibilityViewIsModal
      style={[
        styles.root,
        cover && styles.cover,
        { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <View style={[styles.chip, { backgroundColor: colors.stepsSoft }]}>
          <Ionicons name="cloud-download" size={40} color={colors.stepsText} />
        </View>
        <AppText variant="title" style={styles.center} accessibilityRole="header">
          {t('updates.gate.title')}
        </AppText>
        <AppText variant="body" style={styles.center}>
          {message ?? t('updates.gate.body')}
        </AppText>
        <AppText variant="body" muted style={styles.center}>
          {t('updates.gate.steps')}
        </AppText>
        {NATIVE_BUILD > 0 ? (
          <AppText variant="caption" muted style={styles.center}>
            {t('updates.gate.build', { build: NATIVE_BUILD })}
          </AppText>
        ) : null}
        {stillOld ? (
          <AppText variant="caption" style={[styles.center, { color: colors.warning }]} accessibilityLiveRegion="polite">
            {t('updates.gate.stillOld')}
          </AppText>
        ) : null}
        {openFailed ? (
          <AppText variant="caption" danger style={styles.center} accessibilityLiveRegion="polite">
            {t('updates.gate.failed')}
          </AppText>
        ) : null}
      </ScrollView>

      <View style={styles.actions}>
        <Button label={primaryLabel} variant="primary" icon="open-outline" lines={2} onPress={() => void open(targets.primary)} />
        {targets.secondary ? (
          <Button label={t('updates.gate.openTesting')} lines={2} onPress={() => void open([targets.secondary as string])} />
        ) : null}
        <Button
          label={checking ? t('updates.gate.rechecking') : t('updates.gate.recheck')}
          variant="ghost"
          icon="refresh"
          lines={2}
          loading={checking}
          onPress={() => void check()}
        />
      </View>
    </View>
  );
}

/** Shown while the cold start downloads a newer JS bundle, just before it reloads into it (timeout 8 s). */
export function LaunchUpdateScreen() {
  const { t } = useTranslation('settings');
  const { colors } = useTheme();
  return (
    <View style={[styles.root, styles.centered, { backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <AppText variant="heading" style={styles.center} accessibilityLiveRegion="polite">
        {t('updates.launch.title')}
      </AppText>
      <AppText variant="caption" muted style={styles.center}>
        {t('updates.launch.body')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  centered: { alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center', alignSelf: 'stretch' },
  chip: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  actions: { padding: spacing.lg, gap: spacing.sm },
});

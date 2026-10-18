import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { rogo, type RogoVisibility } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import type { WorkoutPointRow, WorkoutRow } from '@/db/queries';
import { SignInGate } from '@/features/social/SignInGate';
import { buildWatchPost, canShareToRogo, hrSeries, routePairs } from '@/features/social/watchPost';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { errorMessage } from '@/format';
import { HIT, spacing, useColors } from '@/theme';
import { sportLabel } from '@/features/workouts/sportLabel';

/** JoyoRogo's limit for a post caption. */
const CAPTION_MAX = 1000;

interface Props {
  workout: WorkoutRow;
  points: readonly WorkoutPointRow[];
  /** The full analysis of the workout (see `analyzeWorkout`, all options on); null while it is computed or when it failed. */
  analysis: WorkoutAnalysis | null;
  /** True until the analysis has either arrived or failed; posting waits for it so the detail is never a downgrade. */
  analysisPending: boolean;
}

/**
 * "Share to JoyoRogo" for a workout and the composer it opens: a caption, who may see it, and whether the heart-rate
 * data, the route (the post's map, "Tampilkan peta", on by default when the workout has GPS) and the comparison with earlier workouts go along. Free for everyone to share; JoyoRogo decides who may view the detail. Renders nothing for
 * a workout that may not be shared (see `canShareToRogo`).
 */
export function ShareToRogoButton({ workout, points, analysis, analysisPending }: Props) {
  const { t } = useTranslation(['social', 'common']);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<RogoVisibility>('grup');
  const [includeHr, setIncludeHr] = useState(true);
  const [includeRoute, setIncludeRoute] = useState(true);
  const [includeComparison, setIncludeComparison] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postedId, setPostedId] = useState<string | null>(null);
  const hasHr = useMemo(() => hrSeries(points, workout.start, workout.end) !== null, [points, workout.start, workout.end]);
  const hasRoute = useMemo(() => routePairs(points) !== null, [points]);
  const hasComparison = analysis?.comparison != null;

  if (!canShareToRogo(workout)) return null;

  const visibilityOptions = [
    { value: 'grup', label: t('share.visibilityGroup') },
    { value: 'publik', label: t('share.visibilityPublic') },
  ] as const;

  const close = () => {
    setOpen(false);
    setPostedId(null);
    setError(null);
  };

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      const created = await rogo.social.createWatchPost(buildWatchPost(workout, points, { caption, visibility, includeHr, includeRoute, includeComparison }, analysis));
      setCaption('');
      setPostedId(created.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    <>
      <Button label={t('share.button')} icon="people-outline" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" onRequestClose={close} statusBarTranslucent>
        <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
          <View style={styles.header}>
            <AppText variant="heading" accessibilityRole="header" style={styles.headerTitle}>
              {t('share.title')}
            </AppText>
            <PressableScale accessibilityRole="button" accessibilityLabel={t('common:actions.close')} onPress={close} style={styles.close}>
              <Ionicons name="close" size={24} color={colors.foreground} />
            </PressableScale>
          </View>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} keyboardShouldPersistTaps="handled">
            <SignInGate>
              {postedId !== null ? (
                <>
                  <Notice icon="checkmark-circle">{t('share.posted')}</Notice>
                  <Button
                    label={t('share.viewPost')}
                    variant="primary"
                    icon="open-outline"
                    onPress={() => {
                      close();
                      router.push({ pathname: '/social/post/[id]', params: { id: postedId } });
                    }}
                  />
                  <Button label={t('common:actions.done')} onPress={close} />
                </>
              ) : (
                <>
                  <AppText variant="bodyStrong">{sportLabel(workout.sportName)}</AppText>
                  <Field
                    label={t('share.caption')}
                    hint={t('share.captionHint')}
                    value={caption}
                    onChangeText={setCaption}
                    maxLength={CAPTION_MAX}
                    multiline
                    style={styles.caption}
                  />
                  <View style={styles.group}>
                    <AppText variant="label" muted>
                      {t('share.whoCanSee')}
                    </AppText>
                    <Segmented options={visibilityOptions} value={visibility} onChange={setVisibility} />
                    <AppText variant="caption" muted>
                      {visibility === 'grup' ? t('share.hintGroup') : t('share.hintPublic')}
                    </AppText>
                  </View>
                  {hasHr ? <SwitchRow label={t('share.includeHr')} value={includeHr} onValueChange={setIncludeHr} /> : null}
                  {hasRoute ? (
                    <SwitchRow
                      label={t('share.includeRoute')}
                      hint={t('share.includeRouteHint')}
                      value={includeRoute}
                      onValueChange={setIncludeRoute}
                    />
                  ) : null}
                  {hasComparison ? (
                    <SwitchRow label={t('share.includeComparison')} value={includeComparison} onValueChange={setIncludeComparison} />
                  ) : null}
                  <AppText variant="caption" muted>
                    {t('share.note')}
                  </AppText>
                  {error ? <Notice tone="danger">{error}</Notice> : null}
                  <Button label={t('share.post')} variant="primary" icon="send" loading={posting || analysisPending} onPress={() => void post()} />
                </>
              )}
            </SignInGate>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.sm },
  headerTitle: { flex: 1 },
  close: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
  group: { gap: spacing.sm },
  caption: { minHeight: 96, paddingVertical: spacing.sm, textAlignVertical: 'top' },
});

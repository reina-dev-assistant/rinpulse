import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { NavRow } from '@/components/NavRow';
import { Card, Divider } from '@/components/Screen';
import { startStrengthWorkout } from '@/features/strength/start';
import { useStrengthHistory } from '@/features/strength/history';
import { ActiveWorkoutBanner } from '@/features/strength/ui/ActiveWorkoutBanner';
import { useNow } from '@/hooks/useNow';
import { fmtDate, useLocale } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';

import { strengthGlance } from './strengthWeek';

const DIARY_URL = 'https://joyorogo.com/makan?utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-today-strength';

/** Today without a watch starts here: the logger, the way in to routines, and one line about the last workout. */
export function StrengthTodayCard() {
  const { t } = useTranslation('today');
  const router = useRouter();
  const locale = useLocale();
  const { ready, workouts } = useStrengthHistory();
  const now = useNow(60_000);
  const glance = useMemo(() => strengthGlance(workouts, now), [workouts, now]);
  return (
    <View style={styles.stack}>
      <ActiveWorkoutBanner />
      <Card>
        <AppText variant="heading">{t('noWatch.strength.title')}</AppText>
        {ready ? (
          <AppText variant="caption" muted>
            {glance.lastAt === null
              ? t('noWatch.strength.none')
              : t('noWatch.strength.last', {
                  date: fmtDate(new Date(glance.lastAt), 'weekday', locale),
                  name: glance.lastName.length > 0 ? glance.lastName : t('noWatch.strength.untitled'),
                  count: glance.lastWeek,
                })}
          </AppText>
        ) : null}
        <View style={styles.actions}>
          <Button label={t('noWatch.strength.start')} variant="primary" icon="barbell" onPress={() => startStrengthWorkout()} style={styles.action} />
          <Button label={t('noWatch.strength.routines')} icon="albums-outline" onPress={() => router.push('/strength')} style={styles.action} />
        </View>
      </Card>
    </View>
  );
}

/** What else the phone can do on its own: exercise library, history, and a workout from a file. */
export function PhoneOnlyLinks() {
  const { t } = useTranslation('today');
  const router = useRouter();
  return (
    <Card style={styles.flush}>
      <NavRow icon="library-outline" tint="workouts" title={t('noWatch.library.title')} subtitle={t('noWatch.library.subtitle')} onPress={() => router.push('/coach/library')} />
      <Divider />
      <NavRow icon="calendar-outline" tint="steps" title={t('noWatch.history.title')} subtitle={t('noWatch.history.subtitle')} onPress={() => router.push('/strength/history')} />
    </Card>
  );
}

/** One compact prompt instead of the empty watch cards. Pairing stays available here and from the Watch tab. */
export function ConnectWatchPrompt() {
  const { t } = useTranslation('today');
  const router = useRouter();
  return (
    <Card style={styles.flush}>
      <NavRow icon="watch-outline" tint="link" title={t('noWatch.connect.title')} subtitle={t('noWatch.connect.subtitle')} onPress={() => router.push('/watch')} />
    </Card>
  );
}

/** The JoyoRogo link for a strength-only phone: the diary receives the energy of every workout saved here. */
export function RogoStrengthCard() {
  const { t } = useTranslation('today');
  const cloud = useCloud();
  if (cloud.sessionPending) return null;
  return (
    <Card>
      <AppText variant="bodyStrong">{t('noWatch.rogo.title')}</AppText>
      <AppText variant="caption" muted>
        {cloud.signedIn ? t('noWatch.rogo.signedIn') : t('noWatch.rogo.signedOut')}
      </AppText>
      <View style={styles.actions}>
        {cloud.signedIn ? (
          <Button label={t('rogoCard.openDiary')} icon="restaurant" onPress={() => void Linking.openURL(DIARY_URL)} />
        ) : (
          <Button label={t('rogoCard.signIn')} icon="log-in" onPress={() => void cloud.signIn()} />
        )}
      </View>
      {cloud.error ? (
        <AppText variant="caption" muted>
          {cloud.error}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  action: { flexGrow: 1 },
  flush: { padding: 0, gap: 0, overflow: 'hidden' },
});

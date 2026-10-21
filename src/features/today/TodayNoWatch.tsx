import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/Screen';
import { CoachTodayCard } from '@/features/coach/ui/CoachTodayCard';
import { LoopShortcut } from '@/features/loops/ui/LoopShortcut';
import { getLocale, INTL_TAG } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

import { ConnectWatchPrompt, PhoneOnlyLinks, RogoStrengthCard, StrengthTodayCard } from './NoWatchCards';

const WEEKDAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

/**
 * Today for a phone that has never had a watch: the strength logger first, then Coach (its suggestion works from the plan and from how
 * you say you feel), the library and history, one compact "connect a watch" prompt, and the JoyoRogo link. Everything that needs a
 * watch (ring, heart rate, readiness, sleep, health metrics) is left out instead of showing empty.
 */
export function TodayNoWatch() {
  const { t } = useTranslation('common');
  const { dataVersion } = useWatch();
  return (
    <Screen title={t('nav.today')} caption={new Date().toLocaleDateString(INTL_TAG[getLocale()], WEEKDAY_FORMAT)} decorated>
      <View style={styles.stack}>
        <StrengthTodayCard />
        <CoachTodayCard dataVersion={dataVersion} availability={null} />
        <PhoneOnlyLinks />
        <LoopShortcut />
        <ConnectWatchPrompt />
        <RogoStrengthCard />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
});

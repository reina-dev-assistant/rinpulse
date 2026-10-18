import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { useLocale } from '@/i18n';
import { spacing } from '@/theme';
import { bodyText, headlineText, reasonText } from '../format';
import type { Suggestion, SuggestionKind } from '../suggest';

const ICON: Record<SuggestionKind, IconName> = {
  session: 'walk',
  sessionScaled: 'walk',
  sessionEasier: 'walk',
  catchUp: 'refresh',
  free: 'walk',
  activeRest: 'leaf',
  rest: 'bed',
  trainedToday: 'checkmark-circle',
  planDone: 'checkmark-circle',
  planRestDay: 'bed',
  planFinished: 'trophy',
};

/** Headline, one line of explanation and the reasons (the biggest `maxReasons`, or all) of a suggestion. */
export function SuggestionBlock({ suggestion, maxReasons }: { suggestion: Suggestion; maxReasons?: number }) {
  const { t } = useTranslation('coach');
  useLocale();
  const body = bodyText(suggestion);
  const reasons = suggestion.reasons.filter((r) => r.points > 0 || r.code === 'planRestDay' || r.code === 'afterHardDay' || r.code === 'noSignal' || r.code === 'catchUp');
  const shown = maxReasons === undefined ? reasons : reasons.slice(0, maxReasons);
  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <IconChip icon={ICON[suggestion.kind]} tint="workouts" size="md" />
        <View style={styles.text}>
          <AppText variant="heading">{headlineText(suggestion)}</AppText>
          {body ? (
            <AppText variant="caption" muted>
              {body}
            </AppText>
          ) : null}
        </View>
      </View>
      {shown.length > 0 ? (
        <View style={styles.reasons} accessibilityLabel={t('why.title')}>
          {shown.map((reason) => (
            <AppText key={reason.code} variant="caption" muted>
              {`\u2022 ${reasonText(reason)}`}
            </AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  head: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  text: { flex: 1, gap: 2 },
  reasons: { gap: 2 },
});

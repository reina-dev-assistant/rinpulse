import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip, type ChipGlyph } from '@/components/IconChip';
import { useLocale } from '@/i18n';
import { spacing } from '@/theme';
import { bodyText, headlineText, reasonText } from '../format';
import type { Suggestion, SuggestionKind } from '../suggest';
import { SESSION_GLYPH } from './sessionGlyph';

/** Kinds that are not an activity: the other kinds show the glyph of what is suggested (`effective`). */
const STATUS_GLYPH: Partial<Record<SuggestionKind, ChipGlyph>> = {
  catchUp: { icon: 'refresh' },
  activeRest: { icon: 'leaf' },
  rest: { icon: 'bed' },
  trainedToday: { icon: 'checkmark-circle' },
  planDone: { icon: 'checkmark-circle' },
  planRestDay: { icon: 'bed' },
  planFinished: { icon: 'trophy' },
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
        <IconChip {...(STATUS_GLYPH[suggestion.kind] ?? SESSION_GLYPH[suggestion.effective?.type ?? 'easy'])} tint="workouts" size="md" />
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

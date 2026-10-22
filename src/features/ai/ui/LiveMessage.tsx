import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { spacing, useColors } from '@/theme';
import { getLocale } from '@/i18n';
import { formatDurations } from '../durations';
import { liveStatus, runningPhrase, splitStable, type LiveState } from './chatState';
import { Markdown } from './Markdown';
import { ReasoningBlock, StepsCard } from './Steps';

/**
 * The answer while it is being written, in the slot where the finished message will be: the steps (open), the reasoning (closed),
 * the text as it grows, and one still marker after it. Without text yet, one line says what the model is doing. No animation loops:
 * what changes is the text itself.
 */
export const LiveMessage = memo(function LiveMessage({ live, hosted }: { live: LiveState; hosted: boolean }) {
  const { t } = useTranslation('ai');
  const { t: tc } = useTranslation('coach');
  const colors = useColors();
  const status = liveStatus(live);
  const line = hosted
    ? tc('chat.thinking')
    : status.kind === 'tool'
      ? runningPhrase(status.step, t)
      : status.kind === 'reasoning'
        ? t('chat.reasoningLive')
        : t('chat.writing');
  const writing = live.text !== '';
  // Finished paragraphs are drawn once and left alone; only the paragraph being written is parsed and drawn on each update.
  const locale = getLocale() === 'en' ? 'en' : 'id';
  const shown = useMemo(() => formatDurations(live.text, locale), [live.text, locale]);
  const { head, tail } = useMemo(() => splitStable(shown), [shown]);
  return (
    <View style={styles.wrap}>
      {hosted ? null : <StepsCard steps={live.steps} defaultOpen />}
      {hosted ? null : <ReasoningBlock text={live.reasoning} live />}
      {writing ? (
        <>
          {head === '' ? null : <Markdown text={head} color={colors.foreground} />}
          <Markdown text={tail} streaming color={colors.foreground} />
          <View style={[styles.marker, { backgroundColor: colors.mutedForeground }]} />
        </>
      ) : live.reasoning === '' || hosted ? (
        // With reasoning on screen the "Berpikir" row already says it; a second line would repeat it.
        <AppText variant="caption" muted accessibilityLiveRegion="polite">
          {line}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  marker: { width: 8, height: 8, borderRadius: 4 },
});

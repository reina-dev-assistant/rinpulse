import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { fmtInt } from '@/i18n';
import { spacing, useColors, useTheme } from '@/theme';
import type { ChatMessage } from '../conversations';
import type { StepView } from './chatState';
import { Markdown } from './Markdown';
import { ProposedNotes } from './ProposedNotes';
import { ReasoningBlock, StepsCard } from './Steps';
import { modelShort } from './status';

/** A quiet icon action: muted, always visible, a 44 pt target. */
export function ActionButton({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const colors = useColors();
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} scaleTo={0.92} hitSlop={{ top: 4, bottom: 4 }} style={styles.action}>
      <Ionicons name={icon} size={18} color={colors.mutedForeground} />
    </PressableScale>
  );
}

export interface MessageViewProps {
  message: ChatMessage;
  /** The last question: it can be edited. */
  canEdit: boolean;
  /** The last answer: it can be written again. */
  canRegenerate: boolean;
  /** A question with no answer after it (stopped or failed): it can be sent again. */
  canRetry: boolean;
  /** An answer is being written: actions that would start another one rest. */
  busy: boolean;
  onCopy: (message: ChatMessage) => void;
  onRegenerate: () => void;
  onEdit: (message: ChatMessage) => void;
  onRetry: () => void;
  onNote: (messageId: string, note: string, saved: boolean) => void;
}

function UserMessage({ message, canEdit, canRetry, busy, onEdit, onRetry }: MessageViewProps) {
  const { t } = useTranslation('ai');
  const { colors, radius } = useTheme();
  return (
    <View style={styles.mine}>
      <View style={[styles.bubble, { backgroundColor: colors.muted, borderRadius: radius.card }]}>
        <AppText variant="body" selectable>
          {message.content}
        </AppText>
      </View>
      {canEdit || canRetry ? (
        <View style={styles.actions}>
          {canRetry ? <ActionButton icon="refresh" label={t('chat.retry')} disabled={busy} onPress={onRetry} /> : null}
          {canEdit ? <ActionButton icon="create-outline" label={t('chat.edit')} disabled={busy} onPress={() => onEdit(message)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function AssistantMessage({ message, canRegenerate, busy, onCopy, onRegenerate, onNote }: MessageViewProps) {
  const { t } = useTranslation('ai');
  const colors = useColors();
  const steps = useMemo<StepView[]>(() => (message.steps ?? []).map((s) => ({ ...s, running: false })), [message.steps]);
  const label = message.fixed ? null : message.engine === 'rogo' ? t('chat.hosted') : message.model ? modelShort(message.model) : null;
  const tokens = message.engine === 'byok' && message.tokens ? t('chat.tokens', { tokens: fmtInt(message.tokens.input + message.tokens.output) }) : null;
  const meta = [label, tokens, message.stopped ? t('chat.stopped') : null].filter((x): x is string => x !== null).join(' · ');
  return (
    <View style={styles.theirs}>
      <StepsCard steps={steps} defaultOpen={false} />
      <Markdown text={message.content} color={colors.foreground} />
      {message.reasoning ? <ReasoningBlock text={message.reasoning} /> : null}
      {message.proposed && message.proposed.length > 0 ? (
        <ProposedNotes notes={message.proposed} disabled={busy} onSaved={(note) => onNote(message.id, note, true)} onDismiss={(note) => onNote(message.id, note, false)} />
      ) : null}
      <View style={styles.metaRow}>
        <View style={styles.actionsStart}>
          <ActionButton icon="copy-outline" label={t('chat.copy')} onPress={() => onCopy(message)} />
          {canRegenerate ? <ActionButton icon="refresh" label={t('chat.regenerate')} disabled={busy} onPress={onRegenerate} /> : null}
        </View>
        {meta ? (
          <AppText variant="caption" muted numberOfLines={1} style={styles.meta}>
            {meta}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/** One message of the conversation: the question in a bubble on the right, the answer as flowing text across the width. */
export const MessageView = memo(function MessageView(props: MessageViewProps) {
  return props.message.role === 'user' ? <UserMessage {...props} /> : <AssistantMessage {...props} />;
});

const styles = StyleSheet.create({
  mine: { alignItems: 'flex-end' },
  bubble: { maxWidth: '85%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  actions: { flexDirection: 'row' },
  theirs: { gap: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: -spacing.sm },
  actionsStart: { flexDirection: 'row', marginLeft: -spacing.sm },
  meta: { flex: 1, textAlign: 'right' },
  action: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' },
});

import { Ionicons } from '@expo/vector-icons';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextInput } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ChipRow } from '@/components/ChipRow';
import { Input } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { fontSize, spacing, useColors } from '@/theme';

const SUGGESTIONS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const;
/** The box grows to about five lines (22 pt each) and then scrolls. */
const MAX_FIELD_HEIGHT = 22 * 5 + 26;

interface ComposerProps {
  text: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** Stops the answer being written; shown in place of send while `sending`. */
  onStop: () => void;
  sending: boolean;
  /** The person is rewriting an earlier question: a bar says so and can cancel. */
  editing: boolean;
  onCancelEdit: () => void;
  /** Suggestion chips: only on an empty conversation with an empty box. */
  suggest: boolean;
  onSuggest: (question: string) => void;
  maxLength: number;
  inputRef: RefObject<TextInput | null>;
}

/**
 * The composer: suggestions, the editing bar, the multiline box with send (Stop while answering), and the standing line under it.
 * The screen's footer already clears the keyboard and the gesture bar, so nothing here adds a bottom inset of its own.
 */
export function Composer({ text, onChangeText, onSend, onStop, sending, editing, onCancelEdit, suggest, onSuggest, maxLength, inputRef }: ComposerProps) {
  const { t } = useTranslation('ai');
  const { t: tc } = useTranslation('coach');
  const colors = useColors();
  return (
    <View style={styles.footer}>
      {suggest ? (
        <ChipRow
          items={SUGGESTIONS.map((key) => ({ key, label: tc(`chat.suggest.${key}`), selected: false, onPress: () => onSuggest(tc(`chat.suggest.${key}`)) }))}
          fadeColor={colors.background}
        />
      ) : null}
      {editing ? (
        <View style={styles.editing}>
          <Ionicons name="create-outline" size={16} color={colors.mutedForeground} />
          <AppText variant="caption" muted style={styles.editingText}>
            {t('chat.editing')}
          </AppText>
          <PressableScale accessibilityRole="button" accessibilityLabel={t('chat.editCancel')} onPress={onCancelEdit} scaleTo={0.92} style={styles.editingCancel}>
            <Ionicons name="close" size={18} color={colors.mutedForeground} />
          </PressableScale>
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <View style={styles.grow}>
          <Input
            inputRef={inputRef}
            value={text}
            onChangeText={onChangeText}
            placeholder={tc('chat.placeholder')}
            multiline
            maxLength={maxLength}
            accessibilityLabel={tc('chat.placeholder')}
            style={styles.field}
          />
        </View>
        {sending ? (
          <Button label={t('chat.stop')} variant="secondary" icon="stop" iconOnly onPress={onStop} />
        ) : (
          <Button label={tc('chat.send')} variant="primary" icon="send" iconOnly onPress={onSend} disabled={text.trim().length === 0} />
        )}
      </View>
      <AppText variant="caption" muted numberOfLines={1} style={styles.standing}>
        {t('standing')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: spacing.sm },
  editing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  editingText: { flex: 1 },
  editingCancel: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginVertical: -spacing.sm },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  grow: { flex: 1 },
  field: { maxHeight: MAX_FIELD_HEIGHT, paddingVertical: 13, textAlignVertical: 'center' },
  standing: { textAlign: 'center', fontSize: fontSize.xs, lineHeight: 16 },
});

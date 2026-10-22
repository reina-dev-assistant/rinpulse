import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Notice } from '@/components/States';
import { spacing, useTheme } from '@/theme';
import { aiNotes } from '../stores';

interface ProposedNotesProps {
  notes: readonly string[];
  /** Buttons rest while an answer is being written, so a tap cannot race the conversation being saved. */
  disabled?: boolean;
  /** The note was saved, or it already existed. */
  onSaved: (text: string) => void;
  onDismiss: (text: string) => void;
}

/**
 * Notes the model suggested. Each one waits for a tap: "Simpan" writes it to the person's coach notes, "Abaikan" drops it. Nothing
 * is saved on its own, and a full list (20) says so and points at the notes screen instead of failing silently.
 */
export function ProposedNotes({ notes, disabled, onSaved, onDismiss }: ProposedNotesProps) {
  const { t } = useTranslation('ai');
  const { colors, radius } = useTheme();
  const router = useRouter();
  const [full, setFull] = useState(false);

  const save = (text: string) => {
    const result = aiNotes.add(text);
    if (result.ok) {
      setFull(false);
      onSaved(text);
    } else if (result.reason === 'full') setFull(true);
  };

  return (
    <View style={styles.list}>
      {notes.map((text) => (
        <View key={text} style={[styles.chip, { backgroundColor: colors.muted, borderRadius: radius.input }]}>
          <AppText variant="label" muted>
            {t('notes.proposed')}
          </AppText>
          <AppText variant="body" selectable>
            {text}
          </AppText>
          <ButtonRow>
            <Button label={t('notes.save')} variant="primary" icon="checkmark" disabled={disabled} onPress={() => save(text)} />
            <Button label={t('notes.ignore')} disabled={disabled} onPress={() => onDismiss(text)} />
          </ButtonRow>
        </View>
      ))}
      {full ? (
        <Notice tone="danger" action={{ label: t('notes.openList'), onPress: () => router.push('/settings/ai-notes') }}>
          {t('notes.fullHere')}
        </Notice>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, alignSelf: 'stretch' },
  chip: { padding: spacing.md, gap: spacing.sm },
});

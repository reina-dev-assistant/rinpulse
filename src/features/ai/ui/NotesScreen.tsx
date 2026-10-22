import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import { Card, Divider, Screen } from '@/components/Screen';
import { EmptyState } from '@/components/States';
import { useToast } from '@/components/Toast';
import { fmtInt } from '@/i18n';
import { spacing } from '@/theme';
import { MAX_NOTES, NOTE_MAX_CHARS } from '../digest';
import type { CoachNote } from '../memory';
import { aiNotes } from '../stores';

/** The count of characters shows from here on. */
const COUNT_FROM = NOTE_MAX_CHARS - 40;

/** "Catatan coach": what the person told Joyo AI to remember. Sent with every request, kept on this phone, changed only by the person. */
export function NotesScreen() {
  const { t } = useTranslation('ai');
  const { toast, show } = useToast();
  const [notes, setNotes] = useState<CoachNote[]>(aiNotes.list);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [removing, setRemoving] = useState<CoachNote | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const full = notes.length >= MAX_NOTES;

  const add = () => {
    const result = aiNotes.add(draft);
    if (result.ok) {
      setNotes(result.notes);
      setDraft('');
      setProblem(null);
    } else setProblem(result.reason === 'full' ? t('notes.full') : t('notes.emptyDraft'));
  };

  const saveEdit = () => {
    if (!editing) return;
    const result = aiNotes.update(editing.id, editing.text);
    if (result.ok) {
      setNotes(result.notes);
      setEditing(null);
      setProblem(null);
    } else if (result.reason === 'missing') {
      setNotes(aiNotes.list());
      setEditing(null);
    } else setProblem(t('notes.emptyDraft'));
  };

  const remove = () => {
    if (!removing) return;
    setNotes(aiNotes.remove(removing.id));
    setRemoving(null);
    show(t('notes.deleted'));
  };

  return (
    <View style={styles.root}>
      <Screen
        footer={
          <View style={styles.footer}>
            {problem ? (
              <AppText variant="caption" danger accessibilityLiveRegion="polite">
                {problem}
              </AppText>
            ) : null}
            {full ? (
              <AppText variant="caption" muted>
                {t('notes.full')}
              </AppText>
            ) : (
              <View style={styles.addRow}>
                <View style={styles.grow}>
                  <Input
                    value={draft}
                    onChangeText={(v) => {
                      setDraft(v);
                      setProblem(null);
                    }}
                    placeholder={t('notes.placeholder')}
                    accessibilityLabel={t('notes.addLabel')}
                    maxLength={NOTE_MAX_CHARS}
                    multiline
                    style={styles.field}
                  />
                </View>
                <Button label={t('notes.add')} variant="primary" icon="add" iconOnly disabled={draft.trim().length === 0} onPress={add} />
              </View>
            )}
            <AppText variant="caption" muted>
              {draft.length >= COUNT_FROM ? t('notes.chars', { n: fmtInt(draft.length), max: fmtInt(NOTE_MAX_CHARS) }) : t('notes.count', { n: fmtInt(notes.length), max: fmtInt(MAX_NOTES) })}
            </AppText>
          </View>
        }>
        <AppText variant="caption" muted>
          {t('notes.about')}
        </AppText>

        {notes.length === 0 ? (
          <EmptyState icon="document-text" title={t('notes.emptyTitle')} description={t('notes.emptyBody')} />
        ) : (
          <Card>
            {notes.map((note, index) => (
              <View key={note.id} style={styles.note}>
                {index > 0 ? <Divider /> : null}
                {editing?.id === note.id ? (
                  <View style={styles.edit}>
                    <Input
                      value={editing.text}
                      onChangeText={(text) => setEditing({ id: note.id, text })}
                      accessibilityLabel={t('notes.edit')}
                      maxLength={NOTE_MAX_CHARS}
                      multiline
                      autoFocus
                    />
                    <ButtonRow>
                      <Button label={t('notes.save')} variant="primary" icon="checkmark" disabled={editing.text.trim().length === 0} onPress={saveEdit} />
                      <Button label={t('notes.cancel')} onPress={() => setEditing(null)} />
                    </ButtonRow>
                  </View>
                ) : (
                  <View style={styles.line}>
                    <AppText variant="body" selectable style={styles.grow}>
                      {note.text}
                    </AppText>
                    <Button label={t('notes.edit')} variant="ghost" icon="create-outline" iconOnly onPress={() => setEditing({ id: note.id, text: note.text })} />
                    <Button label={t('notes.delete')} variant="destructive" icon="trash-outline" iconOnly onPress={() => setRemoving(note)} />
                  </View>
                )}
              </View>
            ))}
          </Card>
        )}
      </Screen>
      {toast}
      <ConfirmDialog
        visible={removing !== null}
        destructive
        title={t('notes.deleteTitle')}
        message={t('notes.deleteMessage')}
        confirmLabel={t('notes.delete')}
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grow: { flex: 1 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.xs },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  field: { maxHeight: 120 },
  note: { gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  edit: { gap: spacing.sm },
});

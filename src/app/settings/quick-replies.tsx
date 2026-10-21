import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { currentReplies, quickRepliesSupport, resetReplies, saveReplies } from '@/features/settings/quickReplies';
import {
  defaultReplies,
  moveReply,
  removeReply,
  validateReplies,
  type ListProblem,
  type ReplyProblem,
} from '@/features/settings/quickRepliesList';
import { errorMessage } from '@/format';
import { getLocale } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

export default function QuickRepliesScreen() {
  const { t } = useTranslation('settings');
  const { linkState } = useWatch();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `linkState` is the trigger, the native read has no inputs
  const { supported, limits } = useMemo(() => quickRepliesSupport(), [linkState]);
  const [replies, setReplies] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void currentReplies().then(setReplies);
  }, []);

  const list = replies ?? [];
  const validation = useMemo(() => validateReplies(list, limits), [list, limits]);

  const edit = useCallback((next: string[]) => {
    setNote(null);
    setReplies(next);
  }, []);

  const run = async (action: () => Promise<boolean>) => {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      setNote((await action()) ? t('quickReplies.sent') : t('quickReplies.stored'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const rowProblem = (problem: ReplyProblem | null) =>
    problem === null ? null : problem === 'tooLong' ? t('quickReplies.tooLong', { max: limits.maxLength }) : t(`quickReplies.${problem === 'empty' ? 'blank' : 'multiline'}`);
  const listProblem = (problem: ListProblem | null) =>
    problem === null ? null : problem === 'none' ? t('quickReplies.empty') : t('quickReplies.tooMany', { max: limits.slots });

  const message = listProblem(validation.list);

  return (
    <Screen>
      <Section title={t('quickReplies.title')} icon="chatbubble-ellipses">
        <AppText variant="caption" muted>
          {t('quickReplies.intro')}
        </AppText>
        {!supported ? <Notice tone="info">{t('quickReplies.needsWatch')}</Notice> : null}
        {list.map((reply, index) => {
          const problem = rowProblem(validation.items[index] ?? null);
          return (
            <View key={index} style={styles.row}>
              <View style={styles.field}>
                <Input
                  value={reply}
                  placeholder={t('quickReplies.placeholder')}
                  accessibilityLabel={t('quickReplies.placeholder')}
                  onChangeText={(text) => edit(list.map((r, i) => (i === index ? text.replace(/[\r\n]+/g, ' ') : r)))}
                  editable={!busy}
                />
                {problem ? (
                  <AppText variant="caption" muted>
                    {problem}
                  </AppText>
                ) : null}
              </View>
              <Button label={t('quickReplies.moveUp', { n: index + 1 })} icon="arrow-up" iconOnly variant="ghost" disabled={busy || index === 0} onPress={() => edit(moveReply(list, index, index - 1))} />
              <Button label={t('quickReplies.moveDown', { n: index + 1 })} icon="arrow-down" iconOnly variant="ghost" disabled={busy || index === list.length - 1} onPress={() => edit(moveReply(list, index, index + 1))} />
              <Button label={t('quickReplies.remove', { n: index + 1 })} icon="trash" iconOnly variant="destructive" disabled={busy} onPress={() => edit(removeReply(list, index))} />
            </View>
          );
        })}
        <AppText variant="caption" muted>
          {t('quickReplies.count', { count: list.length, max: limits.slots })}
        </AppText>
        {message ? <Notice tone="danger">{message}</Notice> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {note ? <Notice tone="info">{note}</Notice> : null}
        <Button label={t('quickReplies.add')} icon="add" variant="secondary" disabled={busy || list.length >= limits.slots} onPress={() => edit([...list, ''])} />
        <Button label={t('quickReplies.save')} icon="send" disabled={busy || replies === null || !validation.ok} onPress={() => void run(() => saveReplies(list))} />
        <Button
          label={t('quickReplies.reset')}
          variant="ghost"
          disabled={busy}
          onPress={() => {
            setReplies(defaultReplies(getLocale()));
            void run(resetReplies);
          }}
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  field: { flex: 1, gap: spacing.xs },
});

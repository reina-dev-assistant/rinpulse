import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Card, Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { chatFailure, coachChat, MAX_MESSAGE_CHARS, type ChatTurn } from '@/features/coach/chat/api';
import { clearChat, readChat, writeChat } from '@/features/coach/chat/history';
import { buildSnapshot } from '@/features/coach/chat/snapshot';
import { CoachGate } from '@/features/coach/ui/CoachGate';
import { useCoach } from '@/features/coach/useCoach';
import { useNightHrvAvailability } from '@/features/today/useNightHrvAvailability';
import { fmtInt, useLocale } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useTheme } from '@/theme';

function Bubble({ turn }: { turn: ChatTurn }) {
  const { colors, radius } = useTheme();
  const mine = turn.role === 'user';
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowCoach]}>
      <View style={[styles.bubble, { backgroundColor: mine ? colors.primary : colors.muted, borderRadius: radius.card }]}>
        <AppText variant="body" color={mine ? colors.primaryForeground : undefined} selectable>
          {turn.content}
        </AppText>
      </View>
    </View>
  );
}

function ChatBody() {
  const { t } = useTranslation('coach');
  useLocale();
  const { dataVersion } = useWatch();
  const availability = useNightHrvAvailability(dataVersion);
  const coach = useCoach(dataVersion, availability);
  const [turns, setTurns] = useState<ChatTurn[]>(readChat);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; cap: number } | null>(null);
  const [flagged, setFlagged] = useState(false);

  if (!coach) return <Skeleton width="100%" height={220} radius="card" />;

  const send = async (content: string) => {
    const message = content.trim();
    if (!message || sending) return;
    const next: ChatTurn[] = [...turns, { role: 'user', content: message.slice(0, MAX_MESSAGE_CHARS) }];
    setTurns(next);
    setText('');
    setSending(true);
    setError(null);
    try {
      const answer = await coachChat(next, buildSnapshot(coach));
      const done: ChatTurn[] = [...next, { role: 'assistant', content: answer.reply }];
      setTurns(done);
      writeChat(done);
      setUsage({ used: answer.used, cap: answer.cap });
      setFlagged(answer.flagged !== null);
    } catch (e) {
      const failure = chatFailure(e);
      setError(failure.kind === 'cap' ? t('chat.capReached') : failure.kind === 'paywall' ? t('access.upsell.title') : t('chat.error', { message: failure.message }));
      // Keep the question in the box so it can be sent again.
      setTurns(turns);
      setText(message);
    } finally {
      setSending(false);
    }
  };

  const clear = () => {
    clearChat();
    setTurns([]);
    setError(null);
    setFlagged(false);
  };

  return (
    <>
      {turns.length === 0 ? (
        <Card>
          <AppText variant="heading">{t('chat.emptyTitle')}</AppText>
          <AppText variant="caption" muted>
            {t('chat.emptyBody')}
          </AppText>
          <View style={styles.suggestions}>
            {(['q1', 'q2', 'q3'] as const).map((key) => (
              <Button key={key} label={t(`chat.suggest.${key}`)} variant="secondary" lines={2} onPress={() => void send(t(`chat.suggest.${key}`))} disabled={sending} />
            ))}
          </View>
        </Card>
      ) : (
        <View style={styles.list}>
          {turns.map((turn, index) => (
            <Bubble key={index} turn={turn} />
          ))}
        </View>
      )}
      {sending ? (
        <AppText variant="caption" muted>
          {t('chat.thinking')}
        </AppText>
      ) : null}
      {flagged ? <Notice icon="medkit">{t('chat.flagged')}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Input
        value={text}
        onChangeText={setText}
        placeholder={t('chat.placeholder')}
        multiline
        maxLength={MAX_MESSAGE_CHARS}
        editable={!sending}
        accessibilityLabel={t('chat.placeholder')}
      />
      <View style={styles.buttons}>
        <Button label={t('chat.send')} variant="primary" icon="send" onPress={() => void send(text)} disabled={text.trim().length === 0} loading={sending} style={styles.grow} />
        {turns.length > 0 ? <Button label={t('chat.clear')} variant="ghost" icon="trash" onPress={clear} /> : null}
      </View>
      {usage ? (
        <AppText variant="caption" muted>
          {t('chat.usage', { used: fmtInt(usage.used), cap: fmtInt(usage.cap) })}
        </AppText>
      ) : null}
      <AppText variant="caption" muted>
        {t('chat.privacy')}
      </AppText>
      <AppText variant="caption" muted>
        {t('disclaimer')}
      </AppText>
    </>
  );
}

export default function CoachChatScreen() {
  return (
    <Screen>
      <CoachGate campaign="evergreen-coach-chat">
        <ChatBody />
      </CoachGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowCoach: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  suggestions: { gap: spacing.sm, marginTop: spacing.sm },
  buttons: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  grow: { flex: 1 },
});

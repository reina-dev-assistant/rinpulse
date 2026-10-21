import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Input } from '@/components/Input';
import { Card, Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { chatFailure, coachChat, MAX_MESSAGE_CHARS, type ChatTurn } from '@/features/coach/chat/api';
import { clearChat, readChat, writeChat } from '@/features/coach/chat/history';
import { LlmError, LlmNotConfiguredError, localChat } from '@/features/coach/chat/localClient';
import { buildSnapshot } from '@/features/coach/chat/snapshot';
import { usesLocalLlm } from '@/features/coach/localSettings';
import { CoachGate } from '@/features/coach/ui/CoachGate';
import { UpgradeCard } from '@/features/pro/UpgradeCard';
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
  // The server refused the chat because the account is not Pro (the phone's last known answer said it was).
  const [paywall, setPaywall] = useState(false);
  const [usage, setUsage] = useState<{ used: number; cap: number } | null>(null);
  const [flagged, setFlagged] = useState(false);
  // The chat needs an endpoint of its own in the account-free mode; this drives the hint instead of an error.
  const [missingEndpoint, setMissingEndpoint] = useState(false);
  const router = useRouter();

  if (!coach) return <Skeleton width="100%" height={220} radius="card" />;

  const send = async (content: string) => {
    const message = content.trim();
    if (!message || sending) return;
    const next: ChatTurn[] = [...turns, { role: 'user', content: message.slice(0, MAX_MESSAGE_CHARS) }];
    setTurns(next);
    setText('');
    setSending(true);
    setError(null);
    setPaywall(false);
    setMissingEndpoint(false);
    try {
      const snapshot = buildSnapshot(coach);
      // With the account-free mode on, the question goes to the wearer's own endpoint; the JoyoRogo server is
      // only called when it is off, exactly as before.
      if (usesLocalLlm()) {
        const answer = await localChat(next, snapshot);
        const done: ChatTurn[] = [...next, { role: 'assistant', content: answer.reply }];
        setTurns(done);
        writeChat(done);
        // No server accounting with a personal endpoint: `cap` is 0 and the counter stays hidden.
        setUsage(answer.cap > 0 ? { used: answer.used, cap: answer.cap } : null);
        setFlagged(answer.flagged !== null);
        return;
      }
      const answer = await coachChat(next, snapshot);
      const done: ChatTurn[] = [...next, { role: 'assistant', content: answer.reply }];
      setTurns(done);
      writeChat(done);
      setUsage({ used: answer.used, cap: answer.cap });
      setFlagged(answer.flagged !== null);
    } catch (e) {
      if (e instanceof LlmNotConfiguredError) {
        setMissingEndpoint(true);
      } else if (e instanceof LlmError) {
        setError(t('chat.error', { message: e.message }));
      } else {
        const failure = chatFailure(e);
        setPaywall(failure.kind === 'paywall');
        setError(failure.kind === 'cap' ? t('chat.capReached') : failure.kind === 'other' ? t('chat.error', { message: failure.message }) : null);
      }
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
    setPaywall(false);
    setFlagged(false);
    setMissingEndpoint(false);
  };

  return (
    <>
      {turns.length === 0 ? (
        <Card>
          <AppText variant="heading">{t('chat.emptyTitle')}</AppText>
          <View style={styles.suggestions}>
            {(['q1', 'q2', 'q3'] as const).map((key) => (
              <Button key={key} label={t(`chat.suggest.${key}`)} variant="secondary" lines={2} onPress={() => void send(t(`chat.suggest.${key}`))} disabled={sending} />
            ))}
          </View>
          <Details>{t('chat.emptyBody')}</Details>
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
      {paywall ? <UpgradeCard moment="coach-chat" /> : null}
      {missingEndpoint ? (
        <Notice icon="settings-outline">
          {t('chat.needsEndpoint')}
          <Button label={t('chat.openSettings')} variant="secondary" icon="settings-outline" onPress={() => router.push('/settings/coach')} />
        </Notice>
      ) : null}
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
      <Details>
        <AppText variant="caption" muted>
          {t('chat.privacy')}
        </AppText>
        <AppText variant="caption" muted>
          {t('disclaimer')}
        </AppText>
      </Details>
    </>
  );
}

export default function CoachChatScreen() {
  return (
    <Screen>
      <CoachGate moment="coach-chat">
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

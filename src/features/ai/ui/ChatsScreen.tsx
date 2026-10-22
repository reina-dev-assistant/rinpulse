import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Fragment, useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PressableScale } from '@/components/PressableScale';
import { Card, Divider, Screen } from '@/components/Screen';
import { EmptyState } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useNow } from '@/hooks/useNow';
import { formatAgo } from '@/format';
import { useLocale } from '@/i18n';
import { spacing, useColors } from '@/theme';
import type { ConversationMeta } from '../conversations';
import { aiChats } from '../stores';
import { displayTitle, toSeconds } from './chatState';

/** The conversation list, live. The store builds a new array on every read, so the snapshot is kept while nothing in it changed. */
function useChatList(): ConversationMeta[] {
  const cache = useRef<{ key: string; list: ConversationMeta[] }>({ key: '', list: [] });
  const get = useCallback(() => {
    const list = aiChats.list();
    const key = JSON.stringify(list);
    if (key !== cache.current.key) cache.current = { key, list };
    return cache.current.list;
  }, []);
  return useSyncExternalStore(aiChats.subscribe, get, get);
}

/** The history of Joyo AI chats: newest first, tap to open, delete one or all (each asks first). */
export function ChatsScreen() {
  const { t } = useTranslation('ai');
  useLocale();
  const colors = useColors();
  const router = useRouter();
  const { toast, show } = useToast();
  const chats = useChatList();
  const currentId = useSyncExternalStore(aiChats.subscribe, aiChats.current, aiChats.current);
  const now = useNow(60_000);
  const [pending, setPending] = useState<ConversationMeta | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const openChat = (id: string | null) => {
    aiChats.setCurrent(id);
    // The chat goes on top of this list (the history button pops the chat, so none is under it): Back from the chat comes here.
    router.push('/joyo/chat');
  };

  return (
    <View style={styles.root}>
      <Screen>
        {chats.length === 0 ? (
          <EmptyState icon="chatbubbles-outline" title={t('chats.emptyTitle')} description={t('chats.emptyBody')} action={{ label: t('chats.new'), icon: 'add', onPress: () => openChat(null) }} />
        ) : (
          <>
            <Button label={t('chats.new')} variant="primary" icon="add" onPress={() => openChat(null)} />
            <Card style={styles.card}>
              {chats.map((chat, index) => {
                const title = displayTitle(chat.title, t('chat.newTitle'));
                const meta = `${t('chats.count', { count: chat.messageCount })} · ${formatAgo(toSeconds(chat.updatedAt), toSeconds(now))}`;
                return (
                  <Fragment key={chat.id}>
                    {index > 0 ? <Divider /> : null}
                    <View style={styles.row}>
                      <PressableScale
                        accessibilityRole="button"
                        accessibilityLabel={t('chats.open', { title })}
                        accessibilityState={{ selected: chat.id === currentId }}
                        scaleTo={0.99}
                        onPress={() => openChat(chat.id)}
                        style={styles.open}>
                        <View style={styles.text}>
                          <AppText variant="bodyStrong" numberOfLines={1}>
                            {title}
                          </AppText>
                          <AppText variant="caption" muted numberOfLines={1}>
                            {chat.id === currentId ? `${t('chats.current')} · ${meta}` : meta}
                          </AppText>
                        </View>
                      </PressableScale>
                      <PressableScale accessibilityRole="button" accessibilityLabel={t('chats.delete')} onPress={() => setPending(chat)} scaleTo={0.92} style={styles.delete}>
                        <Ionicons name="trash-outline" size={18} color={colors.mutedForeground} />
                      </PressableScale>
                    </View>
                  </Fragment>
                );
              })}
            </Card>
            <Button label={t('chats.deleteAll')} variant="destructive" icon="trash" onPress={() => setConfirmAll(true)} />
          </>
        )}
      </Screen>
      <ConfirmDialog
        visible={pending !== null}
        destructive
        title={t('chats.deleteTitle')}
        message={t('chats.deleteMessage', { title: pending ? displayTitle(pending.title, t('chat.newTitle')) : '' })}
        confirmLabel={t('chats.deleteConfirm')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) aiChats.remove(pending.id);
          setPending(null);
          show(t('chats.deleted'));
        }}
      />
      <ConfirmDialog
        visible={confirmAll}
        destructive
        title={t('chats.deleteAllTitle')}
        message={t('chats.deleteAllMessage', { count: chats.length })}
        confirmLabel={t('chats.deleteAllConfirm')}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => {
          aiChats.clearAll();
          setConfirmAll(false);
          show(t('chats.deleted'));
        }}
      />
      {toast}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  card: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  open: { flex: 1, minHeight: 56, justifyContent: 'center' },
  text: { gap: 2 },
  delete: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

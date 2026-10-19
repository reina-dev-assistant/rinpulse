import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Notice } from '@/components/States';
import { AttachSheet } from '@/features/social/AttachSheet';
import { CommentAttachmentCard } from '@/features/social/CommentAttachmentCard';
import { pickCommentImage } from '@/features/social/pickCommentImage';
import { COMMENT_MAX, pendingPreview, type Comments } from '@/features/social/useComments';
import { errorMessage } from '@/format';
import { fontSize, spacing, useTheme } from '@/theme';

/** Shows the character count from here on. */
const COUNT_FROM = COMMENT_MAX - 60;

/**
 * The bar pinned under the post screen: who is being answered, what is attached, the text box and the buttons. It stays on
 * screen while the post scrolls, and the screen lifts it above the keyboard. Tapping "Balas" on a comment fills it.
 */
export function CommentComposer({ comments }: { comments: Comments }) {
  const { t } = useTranslation('social');
  const { colors, fonts, radius } = useTheme();
  const input = useRef<TextInput>(null);
  const [sheet, setSheet] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const { replyTo, pending, draft, sending } = comments;

  // Answering someone: bring up the keyboard on their name.
  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  const pickPhoto = () => {
    setSheet(false);
    setPickError(null);
    // The gallery opens over the app, not over a sheet that is still sliding away.
    setTimeout(() => {
      setPicking(true);
      pickCommentImage()
        .then((image) => image && comments.setPending({ kind: 'image', image }))
        .catch((e: unknown) => setPickError(errorMessage(e)))
        .finally(() => setPicking(false));
    }, 300);
  };

  const preview = pending ? pendingPreview(pending) : null;
  const busy = sending || picking;
  const placeholder = replyTo ? t('comments.addReply', { name: replyTo.name }) : t('comments.add');

  return (
    <View style={[styles.bar, { backgroundColor: colors.card, borderTopColor: colors.hairline }]}>
      {replyTo ? (
        <View style={styles.replying}>
          <AppText variant="caption" muted style={styles.replyingText} numberOfLines={1}>
            {t('comments.replyingTo', { name: replyTo.name })}
          </AppText>
          <PressableScale accessibilityRole="button" accessibilityLabel={t('comments.cancelReply')} onPress={() => comments.setReplyTo(null)} style={styles.small}>
            <Ionicons name="close" size={18} color={colors.mutedForeground} />
          </PressableScale>
        </View>
      ) : null}
      {preview ? (
        <CommentAttachmentCard attachment={preview.attachment} photo={preview.photo} onRemove={() => comments.setPending(null)} />
      ) : null}
      {comments.problem ? <Notice tone="danger">{comments.problem}</Notice> : null}
      {pickError ? <Notice tone="danger">{pickError}</Notice> : null}
      <View style={styles.row}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('comments.attach.open')}
          disabled={busy}
          onPress={() => setSheet(true)}
          style={styles.button}>
          {picking ? <ActivityIndicator color={colors.mutedForeground} /> : <Ionicons name="add-circle-outline" size={28} color={colors.mutedForeground} />}
        </PressableScale>
        <TextInput
          ref={input}
          accessibilityLabel={placeholder}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          selectionColor={colors.primary}
          value={draft}
          onChangeText={comments.setDraft}
          maxLength={COMMENT_MAX}
          multiline
          editable={!sending}
          style={[styles.input, { backgroundColor: colors.muted, color: colors.foreground, fontFamily: fonts.regular, borderRadius: radius.input }]}
        />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={replyTo ? t('comments.sendReply') : t('comments.send')}
          accessibilityState={{ disabled: !comments.canSend || picking, busy: sending }}
          disabled={!comments.canSend || picking}
          onPress={() => void comments.send()}
          style={styles.button}>
          {sending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Ionicons
              name={comments.sent ? 'checkmark-circle' : 'send'}
              size={24}
              color={comments.canSend && !picking ? colors.primary : colors.mutedForeground}
            />
          )}
        </PressableScale>
      </View>
      {draft.length >= COUNT_FROM ? (
        <AppText variant="caption" muted style={styles.count}>
          {draft.length} / {COMMENT_MAX}
        </AppText>
      ) : null}
      <AttachSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        onPickPhoto={pickPhoto}
        onPickItem={(item) => {
          comments.setPending({ kind: 'item', item });
          setSheet(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm },
  replying: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  replyingText: { flex: 1 },
  small: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: spacing.md, paddingTop: 12, paddingBottom: 12, fontSize: fontSize.md },
  count: { alignSelf: 'flex-end' },
});

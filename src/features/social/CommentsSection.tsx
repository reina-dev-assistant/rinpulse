import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { RogoComment } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FadeIn } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { Divider, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { CommentAttachmentCard } from '@/features/social/CommentAttachmentCard';
import { commentPhotoUrl } from '@/features/social/commentPhotoUrl';
import type { Thread } from '@/features/social/commentThreads';
import type { Comments } from '@/features/social/useComments';
import { useAgo } from '@/features/social/useAgo';
import { spacing, tintColors, useColors } from '@/theme';

/** Width of a reply's indent: the avatar and the gap after it, so a reply lines up under the parent's text. */
const REPLY_INDENT = 32 + spacing.md;

interface RowProps {
  comment: RogoComment;
  canDelete: boolean;
  onReply: (comment: RogoComment) => void;
  onDelete: (comment: RogoComment) => void;
}

function CommentRow({ comment, canDelete, onReply, onDelete }: RowProps) {
  const { t } = useTranslation('social');
  const router = useRouter();
  const colors = useColors();
  const handle = comment.author.handle;
  const ago = useAgo(comment.createdAt);

  if (comment.deleted) {
    return (
      <View style={styles.comment}>
        <View style={styles.avatarSlot} />
        <AppText variant="caption" muted style={styles.commentBody}>
          {t('comments.deleted')}
        </AppText>
      </View>
    );
  }

  const openProfile = () => handle && router.push({ pathname: '/social/u/[handle]', params: { handle } });
  const mention = comment.replyTo?.handle ? `@${comment.replyTo.handle}` : comment.replyTo ? `@${comment.replyTo.name}` : null;
  return (
    <View style={styles.comment}>
      <Avatar name={comment.author.name} image={comment.author.image} size="sm" />
      <View style={styles.commentBody}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('post.openProfile', { name: comment.author.name })}
          disabled={handle === null}
          onPress={openProfile}>
          <AppText variant="bodyStrong">
            {comment.author.name}
            <AppText variant="caption" muted>
              {'  '}
              {ago}
            </AppText>
          </AppText>
        </PressableScale>
        {comment.body || mention ? (
          <AppText variant="body">
            {mention ? (
              <AppText variant="bodyStrong" color={tintColors(colors, 'link').text}>
                {mention}{' '}
              </AppText>
            ) : null}
            {comment.body}
          </AppText>
        ) : null}
        {comment.attachment ? (
          <CommentAttachmentCard
            attachment={comment.attachment}
            photo={
              comment.attachment.kind === 'image' || comment.attachment.hasPhoto
                ? { uri: commentPhotoUrl(comment.id), local: false }
                : null
            }
          />
        ) : null}
        <View style={styles.actions}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('comments.replyTo', { name: comment.author.name })}
            hitSlop={8}
            onPress={() => onReply(comment)}
            style={styles.action}>
            <AppText variant="label" muted>
              {t('comments.reply')}
            </AppText>
          </PressableScale>
          {canDelete ? (
            <PressableScale accessibilityRole="button" hitSlop={8} onPress={() => onDelete(comment)} style={styles.action}>
              <AppText variant="label" muted>
                {t('comments.delete')}
              </AppText>
            </PressableScale>
          ) : null}
        </View>
      </View>
    </View>
  );
}

interface SectionProps {
  comments: Comments;
  /** The signed-in person's account id; they may delete their own comments. */
  me: string | undefined;
  /** The post's author may delete any comment under it. */
  postAuthorId: string;
}

/**
 * The comments of a post, oldest first: each top-level comment with a "View N replies" toggle under it, replies one level
 * deep (a reply to a reply sits in the same list with an @mention), and a placeholder where a deleted comment still has
 * replies. Writing happens in the composer pinned under the screen; "Balas" only fills it.
 */
export function CommentsSection({ comments, me, postAuthorId }: SectionProps) {
  const { t } = useTranslation('social');
  const [confirming, setConfirming] = useState<RogoComment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { state, loaded, error } = comments;

  const canDelete = (c: RogoComment) => me !== undefined && (c.author.id === me || postAuthorId === me);
  const reply = (c: RogoComment) => comments.setReplyTo({ commentId: c.id, name: c.author.name, handle: c.author.handle });

  const confirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      await comments.remove(confirming.id);
    } catch {
      // `comments.problem` already says why; the dialog just closes.
    } finally {
      setDeleting(false);
      setConfirming(null);
    }
  };

  const threadView = (thread: Thread) => {
    const { comment } = thread;
    const unloaded = comment.replyCount > thread.replies.length && (!thread.repliesRead || thread.repliesCursor !== null);
    const loading = comments.loadingMore === comment.id;
    return (
      <View style={styles.thread}>
        <CommentRow comment={comment} canDelete={canDelete(comment) && !comment.deleted} onReply={reply} onDelete={setConfirming} />
        {thread.open ? (
          <View style={styles.replies}>
            {thread.replies.map((r) => (
              <CommentRow key={r.id} comment={r} canDelete={canDelete(r) && !r.deleted} onReply={reply} onDelete={setConfirming} />
            ))}
            {unloaded ? (
              <PressableScale
                accessibilityRole="button"
                disabled={loading}
                onPress={() => void comments.showReplies(thread)}
                style={styles.toggle}>
                <AppText variant="label" muted>
                  {t('comments.moreRepliesCount', { count: comment.replyCount - thread.replies.length })}
                </AppText>
              </PressableScale>
            ) : null}
            <PressableScale accessibilityRole="button" onPress={() => comments.hideReplies(comment.id)} style={styles.toggle}>
              <AppText variant="label" muted>
                {t('comments.hideReplies')}
              </AppText>
            </PressableScale>
          </View>
        ) : comment.replyCount > 0 ? (
          <PressableScale
            accessibilityRole="button"
            disabled={loading}
            onPress={() => void comments.showReplies(thread)}
            style={[styles.toggle, styles.replies]}>
            <AppText variant="label" muted>
              {t('comments.showReplies', { count: comment.replyCount })}
            </AppText>
          </PressableScale>
        ) : null}
      </View>
    );
  };

  return (
    <Section title={t('comments.title')} icon="chatbubbles" tint="link">
      {loaded ? (
        state.threads.length > 0 ? (
          state.threads.map((thread, i) => (
            <FadeIn key={thread.comment.id} delay={i < 6 ? i * 40 : 0} distance={6} style={styles.item}>
              {i > 0 ? <Divider /> : null}
              {threadView(thread)}
            </FadeIn>
          ))
        ) : (
          <AppText variant="caption" muted>
            {t('comments.empty')}
          </AppText>
        )
      ) : error !== null ? (
        <Notice tone="danger">{error}</Notice>
      ) : (
        <Skeleton width="100%" height={56} />
      )}
      {loaded && state.nextCursor !== null ? (
        <Button label={t('comments.loadMore')} loading={comments.loadingMore === 'top'} onPress={() => void comments.loadMore()} />
      ) : null}
      <ConfirmDialog
        visible={confirming !== null}
        title={t('comments.deleteTitle')}
        message={
          confirming && !confirming.parentId && confirming.replyCount > 0
            ? `${t('comments.deleteDescription')} ${t('comments.deleteWithReplies')}`
            : t('comments.deleteDescription')
        }
        confirmLabel={t('comments.deleteConfirm')}
        cancelLabel={t('comments.deleteCancel')}
        destructive
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirming(null)}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.sm },
  thread: { gap: spacing.sm },
  comment: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  avatarSlot: { width: 32 },
  commentBody: { flex: 1, gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.lg },
  action: { minHeight: 32, justifyContent: 'center' },
  replies: { marginLeft: REPLY_INDENT, gap: spacing.sm },
  toggle: { minHeight: 40, justifyContent: 'center' },
});

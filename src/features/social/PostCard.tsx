import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, View } from 'react-native';

import { rogo, type RogoPost } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { IconChip, type IconName } from '@/components/IconChip';
import { useBump } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { RouteMapPreview } from '@/features/social/RouteMapPreview';
import { PillRow, StatPill } from '@/features/social/StatPill';
import { sportKindFromName } from '@/features/social/feedRoute';
import { postFigures, watchStats } from '@/features/social/postStats';
import { useAgo } from '@/features/social/useAgo';
import { sportIcon } from '@/features/workouts/sportIcon';
import { errorMessage } from '@/format';
import { spacing, useColors } from '@/theme';

const KIND_ICON: Record<Exclude<RogoPost['kind'], 'latihan'>, IconName> = {
  makan: 'restaurant',
  berat: 'scale',
  cerita: 'chatbubble-ellipses',
};

interface PostCardProps {
  post: RogoPost;
  /** Called with the post as the server now has it (after a kudos). */
  onChange: (post: RogoPost) => void;
  /** Opens the post. Left out on the post's own screen, where the card is already open. */
  onOpen?: () => void;
  /** Make the author's name open their profile; off on a profile screen. */
  linkAuthor?: boolean;
  /** Draw the route map under the title when the post has one; off on the post's own screen, which shows a larger map. */
  inlineMap?: boolean;
}

/** One post: author, what was done, the numbers, the caption, and the kudos and comment counts. */
export function PostCard({ post, onChange, onOpen, linkAuthor = true, inlineMap = true }: PostCardProps) {
  const { t } = useTranslation('social');
  const router = useRouter();
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const figures = postFigures(post);
  const handle = post.author.handle;
  const ago = useAgo(post.createdAt);
  // A little pop when kudos is given; taking it back is quiet.
  const kudosScale = useBump(post.kudosByMe, post.kudosByMe === true);

  const toggleKudos = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await rogo.social.kudos(post.id);
      onChange({ ...post, kudosByMe: answer.kudos, kudosCount: answer.kudosCount });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const author = (
    <View style={styles.row}>
      <Avatar name={post.author.name} image={post.author.image} size="sm" />
      <View style={styles.grow}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {post.author.name}
        </AppText>
        <AppText variant="caption" muted numberOfLines={1}>
          {handle ? `@${handle} · ` : ''}
          {ago}
        </AppText>
      </View>
      <Ionicons
        name={post.visibility === 'publik' ? 'globe-outline' : 'people-outline'}
        size={18}
        color={colors.mutedForeground}
        accessibilityLabel={post.visibility === 'publik' ? t('post.visibilityPublic') : t('post.visibilityGroup')}
      />
    </View>
  );

  const body = (
    <View style={styles.body}>
      <View style={styles.row}>
        {post.kind === 'latihan' ? (
          <IconChip sport={sportIcon(post.title, watchStats(post)?.sportKind ?? sportKindFromName(post.title))} tint="workouts" size="sm" />
        ) : (
          <IconChip icon={KIND_ICON[post.kind]} tint="workouts" size="sm" />
        )}
        <AppText variant="heading" style={styles.grow}>
          {post.title}
        </AppText>
      </View>
      {inlineMap && post.mapLine ? <RouteMapPreview line={post.mapLine} title={post.title} size="card" /> : null}
      {figures.length > 0 ? (
        <PillRow>
          {figures.map((figure) => (
            <StatPill key={figure.label} label={figure.label} value={figure.value} />
          ))}
        </PillRow>
      ) : null}
      {post.caption ? <AppText variant="body">{post.caption}</AppText> : null}
    </View>
  );

  const comments = (
    <>
      <Ionicons name="chatbubble-outline" size={20} color={colors.mutedForeground} />
      <AppText variant="label" muted>
        {t('post.comments', { count: post.commentCount })}
      </AppText>
    </>
  );

  return (
    <Card>
      {linkAuthor && handle ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('post.openProfile', { name: post.author.name })}
          scaleTo={0.985}
          onPress={() => router.push({ pathname: '/social/u/[handle]', params: { handle } })}>
          {author}
        </PressableScale>
      ) : (
        author
      )}
      {onOpen ? (
        <PressableScale accessibilityRole="button" accessibilityLabel={t('post.open', { title: post.title })} scaleTo={0.985} onPress={onOpen}>
          {body}
        </PressableScale>
      ) : (
        body
      )}
      <View style={styles.footer}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={post.kudosByMe ? t('post.kudosRemove') : t('post.kudosGive')}
          accessibilityState={{ selected: post.kudosByMe === true, busy }}
          disabled={busy}
          hitSlop={8}
          onPress={() => void toggleKudos()}
          style={styles.action}>
          <Animated.View style={{ transform: [{ scale: kudosScale }] }}>
            <Ionicons
              name={post.kudosByMe ? 'thumbs-up' : 'thumbs-up-outline'}
              size={20}
              color={post.kudosByMe ? colors.primary : colors.mutedForeground}
            />
          </Animated.View>
          <AppText variant="label" color={post.kudosByMe ? colors.primary : undefined} muted={!post.kudosByMe}>
            {t('post.kudosCount', { count: post.kudosCount })}
          </AppText>
        </PressableScale>
        {onOpen ? (
          <PressableScale accessibilityRole="button" accessibilityLabel={t('post.commentsOpen', { count: post.commentCount })} hitSlop={8} onPress={onOpen} style={styles.action}>
            {comments}
          </PressableScale>
        ) : (
          <View style={styles.action}>{comments}</View>
        )}
      </View>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  body: { gap: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.lg },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, minHeight: 40 },
});

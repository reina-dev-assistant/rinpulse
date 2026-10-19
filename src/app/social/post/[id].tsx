import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type ScrollView } from 'react-native';

import { authClient } from '@/cloud/auth';
import { rogo } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { CommentComposer } from '@/features/social/CommentComposer';
import { CommentsSection } from '@/features/social/CommentsSection';
import { PostCard } from '@/features/social/PostCard';
import { PostMapSection } from '@/features/social/PostMapSection';
import { SignInGate } from '@/features/social/SignInGate';
import { WorkoutDetailSection } from '@/features/social/WorkoutDetailSection';
import type { DetailMap } from '@/features/social/detailMap';
import { watchStats } from '@/features/social/postStats';
import { useComments } from '@/features/social/useComments';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { useCloud } from '@/state/CloudProvider';
import { spacing, tintColors, useTheme } from '@/theme';

export default function PostScreen() {
  const { t } = useTranslation('common');
  const { t: ts } = useTranslation('social');
  const { colors, radius } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cloud = useCloud();
  const me = authClient.useSession().data?.user.id;
  const load = useCallback(() => rogo.social.post(id), [id]);
  const { data: post, error, refreshing, refresh, setData } = useRogoQuery(load, cloud.signedIn);
  const stats = post ? watchStats(post) : null;
  const [scrubbing, setScrubbing] = useState(false);
  const [detailMap, setDetailMap] = useState<DetailMap>('pending');
  const scroll = useRef<ScrollView>(null);
  const commentsY = useRef(0);

  // The post's own comment count changes quietly: no pull-to-refresh spinner for a comment just sent.
  const countChanged = useCallback(() => {
    void rogo.social.post(id).then(setData, () => {});
  }, [id, setData]);
  const comments = useComments(post?.id ?? null, cloud.signedIn, countChanged);

  const jump = tintColors(colors, 'link');
  return (
    <Screen
      refresh={{ refreshing, onRefresh: () => void refresh(), enabled: cloud.signedIn }}
      scrollEnabled={!scrubbing}
      scrollRef={scroll}
      footer={post && cloud.signedIn ? <CommentComposer comments={comments} /> : undefined}>
      <SignInGate>
        {post ? (
          <>
            <PostCard post={post} onChange={setData} inlineMap={false} />
            {post.commentCount > 0 ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={ts('comments.jumpCount', { count: post.commentCount })}
                onPress={() => scroll.current?.scrollTo({ y: Math.max(0, commentsY.current - spacing.sm), animated: true })}
                style={[styles.jump, { backgroundColor: jump.soft, borderRadius: radius.control }]}>
                <Ionicons name="chatbubbles" size={18} color={jump.text} />
                <AppText variant="label" color={jump.text} style={styles.jumpText}>
                  {ts('comments.jumpCount', { count: post.commentCount })}
                </AppText>
                <Ionicons name="chevron-down" size={18} color={jump.text} />
              </PressableScale>
            ) : null}
            <PostMapSection post={post} mine={post.author.id === me} onChange={setData} preview={stats?.hasDetail !== 1 || detailMap === 'none'} />
            {stats?.hasDetail === 1 ? <WorkoutDetailSection postId={post.id} onScrubActive={setScrubbing} onMap={setDetailMap} /> : null}
            <View onLayout={(e) => (commentsY.current = e.nativeEvent.layout.y)}>
              <CommentsSection comments={comments} me={me} postAuthorId={post.author.id} />
            </View>
          </>
        ) : error !== null ? (
          <Notice tone="danger" action={{ label: t('actions.retry'), onPress: () => void refresh() }}>
            {error}
          </Notice>
        ) : (
          <Skeleton width="100%" height={200} radius="card" />
        )}
      </SignInGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  jump: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  jumpText: { flex: 1 },
});

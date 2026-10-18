import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authClient } from '@/cloud/auth';
import { rogo } from '@/cloud/rogo';
import { Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { CommentsSection } from '@/features/social/CommentsSection';
import { PostCard } from '@/features/social/PostCard';
import { PostMapSection } from '@/features/social/PostMapSection';
import { SignInGate } from '@/features/social/SignInGate';
import { WorkoutDetailSection } from '@/features/social/WorkoutDetailSection';
import { watchStats } from '@/features/social/postStats';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { useCloud } from '@/state/CloudProvider';

export default function PostScreen() {
  const { t } = useTranslation('common');
  const { id } = useLocalSearchParams<{ id: string }>();
  const cloud = useCloud();
  const me = authClient.useSession().data?.user.id;
  const load = useCallback(() => rogo.social.post(id), [id]);
  const { data: post, error, refreshing, refresh, setData } = useRogoQuery(load, cloud.signedIn);
  const stats = post ? watchStats(post) : null;
  const [scrubbing, setScrubbing] = useState(false);

  return (
    <Screen refresh={{ refreshing, onRefresh: () => void refresh(), enabled: cloud.signedIn }} scrollEnabled={!scrubbing}>
      <SignInGate>
        {post ? (
          <>
            <PostCard post={post} onChange={setData} inlineMap={false} />
            <PostMapSection post={post} mine={post.author.id === me} onChange={setData} />
            {stats?.hasDetail === 1 ? <WorkoutDetailSection postId={post.id} onScrubActive={setScrubbing} /> : null}
            <CommentsSection postId={post.id} onAdded={() => void refresh()} />
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

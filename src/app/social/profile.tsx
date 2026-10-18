import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { authClient } from '@/cloud/auth';
import { rogo } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { PostList } from '@/features/social/PostList';
import { ProfileHeader } from '@/features/social/ProfileHeader';
import { ShareMapsCard } from '@/features/social/ShareMapsCard';
import { SignInGate } from '@/features/social/SignInGate';
import { usePagedPosts, wholePage } from '@/features/social/usePagedPosts';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { useCloud } from '@/state/CloudProvider';

/** The signed-in person's feed profile and their own posts. Tapping a post opens it; other people's names open theirs. */
export default function MyProfileScreen() {
  const { t } = useTranslation(['social', 'common']);
  const cloud = useCloud();
  const user = authClient.useSession().data?.user;
  const name = user?.name ?? '';
  const profile = useRogoQuery(rogo.social.myProfile, cloud.signedIn);
  const fetchMine = useCallback((cursor?: number) => rogo.social.myPosts(cursor), []);
  const posts = usePagedPosts('mine', fetchMine, wholePage, cloud.signedIn);

  return (
    <Screen
      refresh={{
        refreshing: profile.refreshing || posts.refreshing,
        onRefresh: () => void Promise.all([profile.refresh(), posts.refresh()]),
        enabled: cloud.signedIn,
      }}>
      <SignInGate>
        {profile.data ? (
          <ProfileHeader
            name={name}
            handle={profile.data.handle}
            image={user?.image}
            counts={{ posts: profile.data.postCount, followers: profile.data.followerCount, following: profile.data.followingCount }}
          />
        ) : profile.error !== null ? (
          <Notice tone="danger" action={{ label: t('common:actions.retry'), onPress: () => void profile.refresh() }}>
            {profile.error}
          </Notice>
        ) : (
          <Skeleton width="100%" height={120} radius="card" />
        )}
        {profile.data ? <ShareMapsCard profile={profile.data} onChange={profile.setData} /> : null}
        <AppText variant="heading" accessibilityRole="header">
          {t('profile.myPosts')}
        </AppText>
        <PostList posts={posts} linkAuthor={false} empty={{ title: t('profile.myPostsEmptyTitle'), description: t('profile.myPostsEmptyDescription') }} />
      </SignInGate>
    </Screen>
  );
}

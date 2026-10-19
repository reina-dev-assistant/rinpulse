import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { rogo, type RogoPost } from '@/cloud/rogo';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { RouteMapPreview } from '@/features/social/RouteMapPreview';
import { watchStats } from '@/features/social/postStats';
import { errorMessage } from '@/format';

interface PostMapSectionProps {
  post: RogoPost;
  /** The signed-in person wrote the post: they get the "Tampilkan peta" switch. */
  mine: boolean;
  /** Called with the post as the server now has it, after the switch changed. */
  onChange: (post: RogoPost) => void;
  /** False while the analysis below draws the same route: the switch stays, the preview steps aside. */
  preview?: boolean;
}

/**
 * The post screen's route map, larger than the feed card's. On the author's own post with a stored map it also holds the
 * per-post switch: JoyoRogo sends the line only while the switch is on, so after a change the post is read again. Renders
 * nothing for a post without a map the viewer may see or switch.
 */
export function PostMapSection({ post, mine, onChange, preview = true }: PostMapSectionProps) {
  const { t } = useTranslation('social');
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stats = watchStats(post);
  const canSwitch = mine && stats?.hasMap === 1;
  const drawn = preview && post.mapLine ? post.mapLine : null;
  if (!drawn && !canSwitch) return null;

  const change = async (show: boolean) => {
    setPending(show);
    setError(null);
    try {
      await rogo.social.setPostMap(post.id, show);
      onChange(await rogo.social.post(post.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      {drawn ? <RouteMapPreview line={drawn} title={post.title} size="detail" /> : null}
      {canSwitch ? (
        <SwitchRow
          label={t('post.map.show')}
          hint={t('post.map.showHint')}
          value={pending ?? stats?.showMap === 1}
          onValueChange={(show) => void change(show)}
          disabled={pending !== null}
        />
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Card>
  );
}

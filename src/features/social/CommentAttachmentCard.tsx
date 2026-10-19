import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { RogoAttachment } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { AuthImage } from '@/features/social/AuthImage';
import { RouteMapPreview } from '@/features/social/RouteMapPreview';
import { PillRow, StatPill } from '@/features/social/StatPill';
import { ATTACHMENT_ICON, attachmentCaption, attachmentFigures, attachmentTitle } from '@/features/social/commentAttachment';
import { spacing, useTheme } from '@/theme';

/** Where the picture of an attachment is: on the phone (before sending) or on JoyoRogo (needs the session). */
export interface AttachmentPhoto {
  uri: string;
  local: boolean;
}

interface CommentAttachmentCardProps {
  attachment: RogoAttachment;
  photo?: AttachmentPhoto | null;
  /** Present in the composer: a button that takes the attachment off the comment. */
  onRemove?: () => void;
}

/**
 * What a comment carries: a photo, or a card with the title, the day, the key numbers and, for a route, its drawing. It
 * shows exactly what JoyoRogo put in the preview, nothing else of the owner's data.
 */
export function CommentAttachmentCard({ attachment, photo, onRemove }: CommentAttachmentCardProps) {
  const { t } = useTranslation('social');
  const { colors, radius } = useTheme();
  const title = attachmentTitle(attachment);
  const remove = onRemove ? (
    <PressableScale accessibilityRole="button" accessibilityLabel={t('comments.attach.remove')} onPress={onRemove} style={styles.remove}>
      <Ionicons name="close-circle" size={24} color={colors.mutedForeground} />
    </PressableScale>
  ) : null;

  if (attachment.kind === 'image') {
    return (
      <View style={styles.imageWrap}>
        {photo ? <AuthImage uri={photo.uri} session={!photo.local} label={t('comments.photoAlt', { name: title })} /> : null}
        {onRemove ? <View style={styles.imageRemove}>{remove}</View> : null}
      </View>
    );
  }

  const figures = attachmentFigures(attachment);
  return (
    <View style={[styles.card, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
      <View style={styles.head}>
        <IconChip icon={ATTACHMENT_ICON[attachment.kind]} tint="workouts" size="sm" />
        <View style={styles.headText}>
          <AppText variant="bodyStrong">{title}</AppText>
          <AppText variant="caption" muted>
            {attachmentCaption(attachment)}
          </AppText>
        </View>
        {remove}
      </View>
      {photo ? <AuthImage uri={photo.uri} session={!photo.local} label={title} aspectRatio={16 / 9} /> : null}
      {attachment.mapLine ? <RouteMapPreview line={attachment.mapLine} title={title} size="card" /> : null}
      {figures.length > 0 ? (
        <PillRow>
          {figures.map((figure) => (
            <StatPill key={figure.label} label={figure.label} value={figure.value} />
          ))}
        </PillRow>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm, alignSelf: 'stretch' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headText: { flex: 1, gap: 2 },
  remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  imageWrap: { alignSelf: 'flex-start', maxWidth: '100%' },
  imageRemove: { position: 'absolute', top: 0, right: 0 },
});

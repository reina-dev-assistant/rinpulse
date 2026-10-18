import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { useTranslation } from '@/i18n';
import { spacing } from '@/theme';

import type { JsonObject } from '../subject';
import { ShareEntryButton } from './ShareEntryButton';
import { StickerSheet } from './StickerSheet';
import { useBadgeSubjects } from './useBadgeSubjects';

/** Share the best earned badge; with several earned, one button per badge, labeled with its title. Not drawn without a badge. */
export function ShareBadgesButton({ dataVersion }: { dataVersion?: number }) {
  const { t } = useTranslation('stickers');
  const subjects = useBadgeSubjects(dataVersion);
  const [picked, setPicked] = useState(0);
  const [open, setOpen] = useState(false);
  const first = subjects[0];
  if (!first) return null;
  if (subjects.length === 1) return <ShareEntryButton subject={first} label={t('ui.entry.badges')} />;
  const subject = subjects[picked] ?? first;
  return (
    <View style={styles.list}>
      {subjects.map((s, i) => (
        <Button
          key={s.id}
          label={String((s.data.milestone as JsonObject | undefined)?.title ?? t('ui.entry.badges'))}
          icon="ribbon-outline"
          onPress={() => {
            setPicked(i);
            setOpen(true);
          }}
        />
      ))}
      <StickerSheet subject={subject} visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
});

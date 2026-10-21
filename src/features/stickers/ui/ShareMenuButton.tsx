import { useState } from 'react';

import { HeaderIconButton } from '@/components/HeaderIconButton';
import { MenuSheet, type MenuItem } from '@/features/strength/ui/Sheet';
import { useTranslation } from '@/i18n';

import type { JsonObject, StickerSubject } from '../subject';
import { StickerSheet } from './StickerSheet';
import { useBadgeSubjects } from './useBadgeSubjects';
import { useWeekSubject } from './useWeekSubject';

/**
 * Header share action for Trends: one icon that opens a menu of what can be shared (this week, then each earned badge,
 * labeled with its title when there are several). Not drawn while loading or when there is nothing to share.
 */
export function ShareMenuButton({ dataVersion }: { dataVersion?: number }) {
  const { t } = useTranslation('stickers');
  const week = useWeekSubject(dataVersion);
  const badges = useBadgeSubjects(dataVersion);
  const [menuOpen, setMenuOpen] = useState(false);
  const [picked, setPicked] = useState<StickerSubject | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const choose = (subject: StickerSubject) => {
    setPicked(subject);
    setSheetOpen(true);
  };
  const items: MenuItem[] = [
    ...(week ? [{ key: 'week', label: t('ui.entry.week'), icon: 'calendar-outline', onPress: () => choose(week) } satisfies MenuItem] : []),
    ...badges.map(
      (subject) =>
        ({
          key: subject.id,
          label: badges.length === 1 ? t('ui.entry.badges') : String((subject.data.milestone as JsonObject | undefined)?.title ?? t('ui.entry.badges')),
          icon: 'ribbon-outline',
          onPress: () => choose(subject),
        }) satisfies MenuItem,
    ),
  ];
  if (items.length === 0) return null;

  return (
    <>
      <HeaderIconButton icon="share-outline" label={t('ui.entry.menu')} onPress={() => setMenuOpen(true)} />
      <MenuSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={t('ui.entry.menu')} items={items} />
      {picked ? <StickerSheet subject={picked} visible={sheetOpen} onClose={() => setSheetOpen(false)} /> : null}
    </>
  );
}

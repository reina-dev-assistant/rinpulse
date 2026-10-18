import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { Button } from '@/components/Button';

import type { StickerSubject } from '../subject';
import { StickerSheet } from './StickerSheet';

/** A share Button that opens the sticker sheet for one subject. The shared tail of every entry point. */
export function ShareEntryButton({ subject, label, style }: { subject: StickerSubject; label: string; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button label={label} icon="share-outline" onPress={() => setOpen(true)} style={style} />
      <StickerSheet subject={subject} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

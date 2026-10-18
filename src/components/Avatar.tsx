import { useState } from 'react';
import { Image, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { JOYOROGO_URL } from '@/cloud/config';
import { useColors } from '@/theme';

const SIZES = { sm: 32, md: 40, lg: 48, xl: 56 } as const;

/** JoyoRogo stores uploaded photos as server-relative `/avatar/...` paths and Google photos as absolute URLs. */
export function avatarUri(image: string | null | undefined): string | null {
  if (!image) return null;
  return image.startsWith('/') ? `${JOYOROGO_URL}${image}` : image;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase();
}

interface AvatarProps {
  name: string;
  /** `image` as JoyoRogo returns it; null, or a photo that fails to load, shows the initials. */
  image?: string | null;
  size?: keyof typeof SIZES;
}

/** Round profile photo with an initials fallback. Decorative: the name is always printed next to it. */
export function Avatar({ name, image, size = 'sm' }: AvatarProps) {
  const colors = useColors();
  const [failed, setFailed] = useState<string | null>(null);
  const box = SIZES[size];
  const uri = avatarUri(image);
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        width: box,
        height: box,
        borderRadius: box / 2,
        backgroundColor: colors.muted,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      {uri && failed !== uri ? (
        <Image source={{ uri }} style={{ width: box, height: box }} onError={() => setFailed(uri)} />
      ) : (
        <AppText variant="bodyStrong" style={{ fontSize: Math.round(box * 0.38), lineHeight: Math.round(box * 0.5) }}>
          {initials(name)}
        </AppText>
      )}
    </View>
  );
}

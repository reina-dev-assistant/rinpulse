import { useRouter, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BrandMark } from '@/components/BrandMark';
import type { IconName } from '@/components/IconChip';
import { isIos } from '@/components/IosUnavailable';
import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme';

interface ImportRow {
  key: string;
  title: string;
  subtitle: string;
  href: Href;
  icon?: IconName;
  leading?: ReactNode;
}

/** Where history from other apps comes in: Huawei Health, Apple Health (iPhone only) and FIT files. */
export default function ImportScreen() {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const router = useRouter();

  const rows: readonly ImportRow[] = [
    {
      key: 'huawei',
      title: t('index.rows.importHuawei.title'),
      subtitle: t('index.rows.importHuawei.subtitle'),
      icon: 'cloud-download',
      href: '/settings/import-huawei',
    },
    ...(isIos
      ? [
          {
            key: 'apple-health',
            title: t('index.rows.importAppleHealth.title'),
            subtitle: t('index.rows.importAppleHealth.subtitle'),
            leading: <BrandMark brand="apple-health" />,
            href: '/settings/import-apple-health' as const,
          },
        ]
      : []),
    {
      key: 'fit',
      title: t('index.rows.importFit.title'),
      subtitle: t('index.rows.importFit.subtitle'),
      icon: 'bicycle',
      href: '/settings/import-fit',
    },
  ];

  return (
    <Screen>
      <View>
        {rows.map((row, index) => (
          <NavRow
            key={row.key}
            icon={row.icon}
            tint={row.icon ? 'workouts' : undefined}
            leading={row.leading}
            title={row.title}
            subtitle={row.subtitle}
            onPress={() => router.push(row.href)}
            style={groupedRowStyle(theme, index, rows.length)}
          />
        ))}
      </View>
    </Screen>
  );
}

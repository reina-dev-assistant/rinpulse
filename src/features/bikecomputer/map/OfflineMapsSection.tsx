import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Divider, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { formatSize } from '@/cloud/estimate';
import { fmtDay, useLocale } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import { buildRows, downloadBusy, regionName, type RegionRow } from './offlineMapsModel';
import { totalInstalledBytes } from './storage';
import { useOfflineMaps, type OfflineMaps } from './useOfflineMaps';

/** Fallback licence page for when the catalog (which carries its own link) could not load. */
const ODBL_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';

/** `20261018` as a calendar day; anything else is shown as it came. */
function versionDate(version: string, locale: 'id' | 'en'): string {
  return /^\d{8}$/.test(version) ? fmtDay(`${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}`, 'medium', locale) : version;
}

/**
 * Settings > Peta offline: the regions from the catalog with size and Unduh / Perbarui / Hapus, a progress bar while one
 * downloads (Jeda, Batal), free storage, a Wi-Fi note on mobile data, and the ODbL credit with a link. Offline, only the
 * installed regions are listed, with a note. Mounted by Settings, which owns the screen around it.
 */
export function OfflineMapsSection() {
  const { t } = useTranslation('bikemap');
  const locale = useLocale();
  const maps = useOfflineMaps();
  const [deleting, setDeleting] = useState<RegionRow | null>(null);

  const index = maps.catalog.status === 'ready' ? maps.catalog.index : null;
  const rows = useMemo(
    () => buildRows({ index, installed: maps.installed, state: maps.state }),
    [index, maps.installed, maps.state],
  );
  const busy = downloadBusy(maps.state);
  const used = totalInstalledBytes(maps.installed);

  return (
    <Section title={t('section.title')} icon="map-outline" tint="link">
      <View style={styles.stack}>
        <AppText variant="caption" muted>
          {t('section.intro')}
        </AppText>
        <AppText variant="caption" muted>
          {used > 0
            ? t('section.storage', { free: formatSize(maps.freeBytes), used: formatSize(used) })
            : t('section.storageNone', { free: formatSize(maps.freeBytes) })}
        </AppText>

        {maps.network === 'cellular' ? (
          <Notice icon="cellular-outline">{t('section.cellular')}</Notice>
        ) : null}

        {maps.catalog.status === 'loading' ? (
          <AppText variant="caption" muted>
            {t('section.catalogLoading')}
          </AppText>
        ) : null}
        {maps.catalog.status === 'failed' ? (
          <Notice icon="cloud-offline-outline" action={{ label: t('action.retry'), onPress: maps.reloadCatalog }}>
            {maps.network === 'offline' ? t('section.catalogOffline') : t('section.catalogFailed')}
          </Notice>
        ) : null}
        {maps.catalog.status === 'ready' && rows.length === 0 ? (
          <AppText variant="caption" muted>
            {t('section.empty')}
          </AppText>
        ) : null}

        {rows.map((row, i) => (
          <View key={row.id} style={styles.stack}>
            {i > 0 ? <Divider /> : null}
            <RegionRowView row={row} maps={maps} locale={locale} blocked={busy && !isActive(row)} onDelete={() => setDeleting(row)} />
          </View>
        ))}

        <Divider />
        <AppText variant="label">{t('section.licenseTitle')}</AppText>
        {index ? (
          <AppText variant="caption" muted selectable>
            {index.attribution}
          </AppText>
        ) : null}
        <Details>{t('section.licenseNote')}</Details>
        <Button
          label={t('section.licenseLink')}
          variant="ghost"
          icon="open-outline"
          onPress={() => void Linking.openURL(index?.licenseUrl ?? ODBL_URL)}
        />
      </View>

      <ConfirmDialog
        visible={deleting !== null}
        title={deleting ? t('confirm.deleteTitle', { name: regionName(deleting.name, locale) }) : ''}
        message={deleting ? t('confirm.deleteMessage', { size: formatSize(deleting.installed?.bytes ?? deleting.bytes) }) : ''}
        confirmLabel={t('confirm.deleteAction')}
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) maps.remove(deleting.id);
          setDeleting(null);
        }}
      />
    </Section>
  );
}

const isActive = (row: RegionRow) => row.status === 'downloading' || row.status === 'paused' || row.status === 'verifying';

interface RegionRowViewProps {
  row: RegionRow;
  maps: OfflineMaps;
  locale: 'id' | 'en';
  /** Another region is downloading: this row's buttons wait. */
  blocked: boolean;
  onDelete: () => void;
}

function RegionRowView({ row, maps, locale, blocked, onDelete }: RegionRowViewProps) {
  const { t } = useTranslation('bikemap');
  const { colors } = useTheme();
  const name = regionName(row.name, locale);
  const size = formatSize(row.latest?.bytes ?? row.bytes);
  const received = row.progress === null ? 0 : Math.round(row.progress * (row.latest?.bytes ?? row.bytes));
  const state = maps.state;
  const failedHere = state.phase === 'failed' && state.regionId === row.id ? state : null;

  const subtitle = (() => {
    switch (row.status) {
      case 'installed':
        return t('row.installed', { date: versionDate(row.installed?.version ?? '', locale) });
      case 'updatable':
        return t('row.updatable', { date: versionDate(row.latest?.version ?? '', locale), size });
      case 'downloading':
        return t('row.progress', { done: formatSize(received), size });
      case 'paused':
        return t('row.paused', { done: formatSize(received), size });
      case 'verifying':
        return t('row.verifying');
      default:
        return t('row.available', { size });
    }
  })();

  const failureText = (() => {
    if (!failedHere) return null;
    if (failedHere.kind === 'noSpace') {
      return failedHere.needBytes !== undefined && failedHere.freeBytes !== undefined
        ? t('download.failed.noSpace', { need: formatSize(failedHere.needBytes), free: formatSize(failedHere.freeBytes) })
        : t('download.failed.noSpaceShort');
    }
    return t(failedHere.kind === 'network' ? 'download.failed.network' : 'download.failed.corrupt');
  })();

  const latest = row.latest;
  const start = () => {
    if (!latest) return;
    maps.acknowledge();
    maps.download(latest);
  };

  return (
    <View style={styles.stack}>
      <View style={styles.titleRow}>
        <AppText variant="bodyStrong" style={styles.grow}>
          {name}
        </AppText>
      </View>
      <AppText variant="caption" muted>
        {subtitle}
      </AppText>

      {row.progress !== null ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('row.progressLabel', { name })}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(row.progress * 100) }}
          style={[styles.track, { backgroundColor: colors.muted }]}>
          <View style={[styles.fill, { backgroundColor: colors.primary, width: `${Math.round(row.progress * 100)}%` }]} />
        </View>
      ) : null}

      {failureText ? (
        <Notice tone="danger" action={latest ? { label: t('action.retry'), onPress: start } : undefined}>
          {failureText}
        </Notice>
      ) : null}

      <View style={styles.actions}>
        {row.status === 'downloading' ? (
          <>
            <Button label={t('action.pause')} icon="pause" style={styles.grow} onPress={maps.pause} />
            <Button label={t('action.cancel')} style={styles.grow} onPress={maps.cancel} />
          </>
        ) : null}
        {row.status === 'paused' ? (
          <>
            <Button label={t('action.resume')} variant="primary" icon="play" style={styles.grow} onPress={maps.resume} />
            <Button label={t('action.cancel')} style={styles.grow} onPress={maps.cancel} />
          </>
        ) : null}
        {row.status === 'verifying' ? <Button label={t('row.verifying')} loading disabled onPress={() => {}} /> : null}
        {(row.status === 'available' || row.status === 'failed') && latest ? (
          <Button
            label={row.status === 'failed' ? t('action.retry') : t('action.download')}
            variant="primary"
            icon="download-outline"
            disabled={blocked}
            style={styles.grow}
            onPress={start}
          />
        ) : null}
        {row.status === 'updatable' ? (
          <Button label={t('action.update')} variant="primary" icon="refresh" disabled={blocked} style={styles.grow} onPress={start} />
        ) : null}
        {row.installed && !isActive(row) ? (
          <Button label={t('action.delete')} icon="trash-outline" disabled={blocked} style={styles.grow} onPress={onDelete} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});

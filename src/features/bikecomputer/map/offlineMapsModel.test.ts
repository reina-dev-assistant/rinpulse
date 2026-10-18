import { describe, expect, test } from 'bun:test';

import type { DownloadState } from './download';
import { buildRows, downloadBusy, regionName } from './offlineMapsModel';
import type { MapRegion } from './regions';
import type { InstalledRegion } from './storage';

const catalog = (id: string, version = '20261018', bytes = 100_000_000): MapRegion => ({
  id,
  name: { id: `${id}-id`, en: `${id}-en` },
  bbox: [110, -8, 111, -7],
  bytes,
  version,
  sha256: 'a'.repeat(64),
  url: `https://maps.example.test/${id}-${version}.pmtiles`,
});

const have = (id: string, version = '20261018'): InstalledRegion => ({
  id,
  name: { id: `${id}-id`, en: `${id}-en` },
  bbox: [110, -8, 111, -7],
  version,
  bytes: 90_000_000,
  path: `file:///maps/${id}-${version}.pmtiles`,
  installedAt: 1,
});

const IDLE: DownloadState = { phase: 'idle' };

describe('buildRows', () => {
  test('available, installed and updatable', () => {
    const rows = buildRows({
      index: { regions: [catalog('bali'), catalog('diy', '20261201'), catalog('jawa')] },
      installed: [have('bali'), have('diy', '20261018')],
      state: IDLE,
    });
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['bali', 'installed'],
      ['diy', 'updatable'],
      ['jawa', 'available'],
    ]);
    expect(rows[1]?.latest?.version).toBe('20261201');
    expect(rows[1]?.installed?.version).toBe('20261018');
  });

  test('offline: installed regions only, nothing to download or update', () => {
    const rows = buildRows({ index: null, installed: [have('bali')], state: IDLE });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'bali', status: 'installed', latest: null, bytes: 90_000_000 });
  });

  test('an installed region the catalog dropped is listed after the catalog ones', () => {
    const rows = buildRows({ index: { regions: [catalog('bali')] }, installed: [have('old'), have('bali')], state: IDLE });
    expect(rows.map((r) => r.id)).toEqual(['bali', 'old']);
    expect(rows[1]?.latest).toBeNull();
  });

  test('progress follows the download state of its own region only', () => {
    const state: DownloadState = { phase: 'downloading', regionId: 'bali', received: 25, total: 100 };
    const rows = buildRows({ index: { regions: [catalog('bali'), catalog('diy')] }, installed: [], state });
    expect(rows[0]).toMatchObject({ status: 'downloading', progress: 0.25 });
    expect(rows[1]).toMatchObject({ status: 'available', progress: null });
  });

  test('paused, verifying and failed map to their rows', () => {
    const index = { regions: [catalog('bali')] };
    expect(buildRows({ index, installed: [], state: { phase: 'paused', regionId: 'bali', received: 50, total: 100 } })[0]).toMatchObject({
      status: 'paused',
      progress: 0.5,
    });
    expect(buildRows({ index, installed: [], state: { phase: 'verifying', regionId: 'bali' } })[0]?.status).toBe('verifying');
    expect(
      buildRows({ index, installed: [], state: { phase: 'failed', regionId: 'bali', kind: 'noSpace', needBytes: 1, freeBytes: 0 } })[0],
    ).toMatchObject({ status: 'failed', failure: 'noSpace' });
  });

  test('progress is clamped and survives a zero total', () => {
    const index = { regions: [catalog('bali')] };
    expect(buildRows({ index, installed: [], state: { phase: 'downloading', regionId: 'bali', received: 150, total: 100 } })[0]?.progress).toBe(1);
    expect(buildRows({ index, installed: [], state: { phase: 'downloading', regionId: 'bali', received: 5, total: 0 } })[0]?.progress).toBe(0);
  });

  test('installed or cancelled states fall back to the registry', () => {
    const index = { regions: [catalog('bali')] };
    const installed = [have('bali')];
    expect(buildRows({ index, installed, state: { phase: 'installed', regionId: 'bali', region: have('bali') } })[0]?.status).toBe('installed');
    expect(buildRows({ index, installed: [], state: { phase: 'cancelled', regionId: 'bali' } })[0]?.status).toBe('available');
  });
});

describe('helpers', () => {
  test('downloadBusy', () => {
    expect(downloadBusy(IDLE)).toBe(false);
    expect(downloadBusy({ phase: 'downloading', regionId: 'a', received: 0, total: 1 })).toBe(true);
    expect(downloadBusy({ phase: 'paused', regionId: 'a', received: 0, total: 1 })).toBe(true);
    expect(downloadBusy({ phase: 'verifying', regionId: 'a' })).toBe(true);
    expect(downloadBusy({ phase: 'failed', regionId: 'a', kind: 'network' })).toBe(false);
    expect(downloadBusy({ phase: 'cancelled', regionId: 'a' })).toBe(false);
  });

  test('regionName picks the locale', () => {
    expect(regionName({ id: 'Seluruh Jawa', en: 'All of Java' }, 'en')).toBe('All of Java');
    expect(regionName({ id: 'Seluruh Jawa', en: 'All of Java' }, 'id')).toBe('Seluruh Jawa');
  });
});

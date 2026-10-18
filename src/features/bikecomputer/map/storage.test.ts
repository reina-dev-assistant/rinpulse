import { describe, expect, test } from 'bun:test';

import type { MapRegion } from './regions';
import {
  createInstalledStore,
  INSTALLED_KEY,
  mapsDirUri,
  parseInstalled,
  pmtilesHeaderProblem,
  pmtilesStreamUrl,
  pmtilesUrl,
  regionPath,
  removeInstalled,
  toInstalled,
  totalInstalledBytes,
  updatesAvailable,
  upsertInstalled,
  type InstalledRegion,
  type KvLike,
} from './storage';

const installed = (id: string, version = '20261018', bytes = 100): InstalledRegion => ({
  id,
  name: { id, en: id },
  bbox: [114.4, -8.92, 115.74, -8.04],
  version,
  bytes,
  path: `file:///data/maps/${id}-${version}.pmtiles`,
  installedAt: 1_700_000_000_000,
});

describe('pmtilesUrl', () => {
  const single = 'pmtiles://file:///data/user/0/app/files/maps/bali-20261018.pmtiles';

  test('wraps a file URI once', () => {
    expect(pmtilesUrl('file:///data/user/0/app/files/maps/bali-20261018.pmtiles')).toBe(single);
  });

  test('wraps a bare absolute path', () => {
    expect(pmtilesUrl('/data/user/0/app/files/maps/bali-20261018.pmtiles')).toBe(single);
  });

  test('strips a doubled scheme (the documented failure)', () => {
    expect(pmtilesUrl('file://file:///data/user/0/app/files/maps/bali-20261018.pmtiles')).toBe(single);
    expect(pmtilesUrl('pmtiles://file://file:///data/user/0/app/files/maps/bali-20261018.pmtiles')).toBe(single);
    expect(pmtilesUrl(single)).toBe(single);
  });

  test('never produces more than one file:// or pmtiles://', () => {
    const out = pmtilesUrl('pmtiles://pmtiles://file://file:////x/y.pmtiles');
    expect(out.match(/file:\/\//g)).toHaveLength(1);
    expect(out.match(/pmtiles:\/\//g)).toHaveLength(1);
  });

  test('keeps an encoded space as the file API gave it', () => {
    expect(pmtilesUrl('file:///Users/a%20b/maps/x.pmtiles')).toBe('pmtiles://file:///Users/a%20b/maps/x.pmtiles');
  });
});

describe('pmtilesStreamUrl', () => {
  test('https only', () => {
    expect(pmtilesStreamUrl('https://maps.example.test/a.pmtiles')).toBe('pmtiles://https://maps.example.test/a.pmtiles');
    expect(pmtilesStreamUrl('pmtiles://https://maps.example.test/a.pmtiles')).toBe(
      'pmtiles://https://maps.example.test/a.pmtiles',
    );
    expect(pmtilesStreamUrl('http://maps.example.test/a.pmtiles')).toBeNull();
    expect(pmtilesStreamUrl('file:///a.pmtiles')).toBeNull();
  });
});

describe('paths', () => {
  test('regionPath sits under documentDirectory/maps/', () => {
    expect(regionPath('bali', '20261018', 'file:///docs/')).toBe('file:///docs/maps/bali-20261018.pmtiles');
    expect(regionPath('bali', '20261018', 'file:///docs')).toBe('file:///docs/maps/bali-20261018.pmtiles');
    expect(mapsDirUri('file:///docs//')).toBe('file:///docs/maps/');
  });
});

describe('pmtilesHeaderProblem', () => {
  const head = () => {
    const bytes = new Uint8Array(127);
    bytes.set([...'PMTiles'].map((c) => c.charCodeAt(0)));
    bytes[7] = 3;
    return bytes;
  };

  test('accepts magic + version 3', () => {
    expect(pmtilesHeaderProblem(head())).toBeNull();
  });

  test('flags short, magic and version problems', () => {
    expect(pmtilesHeaderProblem(head().slice(0, 100))).toBe('short');
    const bad = head();
    bad[3] = 0;
    expect(pmtilesHeaderProblem(bad)).toBe('magic');
    const v2 = head();
    v2[7] = 2;
    expect(pmtilesHeaderProblem(v2)).toBe('version');
  });
});

describe('registry helpers', () => {
  test('parseInstalled survives garbage and drops bad or duplicate entries', () => {
    expect(parseInstalled(null)).toEqual([]);
    expect(parseInstalled('not json')).toEqual([]);
    expect(parseInstalled('{"a":1}')).toEqual([]);
    const good = installed('bali');
    const parsed = parseInstalled(JSON.stringify([good, { id: 'x' }, good, { ...good, id: 'diy' }]));
    expect(parsed.map((r) => r.id)).toEqual(['bali', 'diy']);
  });

  test('upsert replaces by id and remove deletes', () => {
    const list = upsertInstalled([installed('bali', '20261018'), installed('diy')], installed('bali', '20261201'));
    expect(list.map((r) => `${r.id}:${r.version}`).sort()).toEqual(['bali:20261201', 'diy:20261018']);
    expect(removeInstalled(list, 'diy').map((r) => r.id)).toEqual(['bali']);
    expect(totalInstalledBytes(list)).toBe(200);
  });

  test('updatesAvailable pairs newer catalog builds only', () => {
    const entry = (id: string, version: string): MapRegion => ({
      id,
      name: { id, en: id },
      bbox: [114.4, -8.92, 115.74, -8.04],
      bytes: 100,
      version,
      sha256: 'a'.repeat(64),
      url: `https://x.test/${id}.pmtiles`,
    });
    const catalog = { regions: [entry('bali', '20261201'), entry('diy', '20261018')] };
    const updates = updatesAvailable([installed('bali', '20261018'), installed('diy', '20261018'), installed('jawa')], catalog);
    expect(updates.map((u) => u.latest.id)).toEqual(['bali']);
  });

  test('toInstalled copies the catalog fields', () => {
    const region: MapRegion = {
      id: 'bali',
      name: { id: 'Bali', en: 'Bali' },
      bbox: [1, 2, 3, 4],
      bytes: 5,
      version: '20261018',
      sha256: 'a'.repeat(64),
      url: 'https://x.test/b.pmtiles',
    };
    expect(toInstalled(region, 'file:///p', 9)).toEqual({
      id: 'bali',
      name: { id: 'Bali', en: 'Bali' },
      bbox: [1, 2, 3, 4],
      version: '20261018',
      bytes: 5,
      path: 'file:///p',
      installedAt: 9,
    });
  });
});

describe('createInstalledStore', () => {
  function fakeKv() {
    const data = new Map<string, string>();
    const kv: KvLike = {
      getItemSync: (key) => data.get(key) ?? null,
      setItemSync: (key, value) => void data.set(key, value),
    };
    return { data, kv };
  }

  test('round-trips through the kv under the documented key', () => {
    const { data, kv } = fakeKv();
    const store = createInstalledStore(kv);
    expect(store.read()).toEqual([]);
    store.upsert(installed('bali'));
    store.upsert(installed('diy'));
    expect(data.has(INSTALLED_KEY)).toBe(true);
    expect(INSTALLED_KEY).toBe('joyofit.bike.maps');
    expect(store.read().map((r) => r.id)).toEqual(['bali', 'diy']);
    store.remove('bali');
    expect(createInstalledStore(kv).read().map((r) => r.id)).toEqual(['diy']);
  });
});

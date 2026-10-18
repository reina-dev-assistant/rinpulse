import { describe, expect, test } from 'bun:test';

import { COVERAGE_HYSTERESIS_DEG, pickInstalledRegion } from './coverage';
import type { InstalledRegion } from './storage';

const region = (id: string, bbox: [number, number, number, number], version = '20261018'): InstalledRegion => ({
  id,
  name: { id, en: id },
  bbox,
  version,
  bytes: 1,
  path: `file:///maps/${id}-${version}.pmtiles`,
  installedAt: 1,
});

const BALI = region('bali', [114.4, -8.92, 115.74, -8.04]);
const DIY = region('diy', [110.0, -8.22, 110.85, -7.52]);
const JATENG = region('jawa-tengah', [108.5, -8.25, 111.75, -5.7]);

describe('pickInstalledRegion', () => {
  test('null with nothing installed or a position nobody covers', () => {
    expect(pickInstalledRegion([], { lat: -8.65, lon: 115.2 })).toBeNull();
    expect(pickInstalledRegion([BALI], { lat: 1.3, lon: 103.8 })).toBeNull();
    expect(pickInstalledRegion([BALI], null)).toBeNull();
  });

  test('picks the containing region, the smallest where they overlap', () => {
    expect(pickInstalledRegion([BALI, DIY, JATENG], { lat: -8.65, lon: 115.2 })?.id).toBe('bali');
    expect(pickInstalledRegion([BALI, JATENG, DIY], { lat: -7.8, lon: 110.37 })?.id).toBe('diy');
  });

  test('keeps the current region slightly past its edge, drops it beyond the margin', () => {
    const justOutside = { lat: -8.65, lon: BALI.bbox[2] + COVERAGE_HYSTERESIS_DEG / 2 };
    expect(pickInstalledRegion([BALI], justOutside, BALI)?.id).toBe('bali');
    expect(pickInstalledRegion([BALI], justOutside)).toBeNull();
    const farOutside = { lat: -8.65, lon: BALI.bbox[2] + COVERAGE_HYSTERESIS_DEG * 2 };
    expect(pickInstalledRegion([BALI], farOutside, BALI)).toBeNull();
  });

  test('a stale current region (deleted, or replaced by a newer version) is not kept', () => {
    const pos = { lat: -8.65, lon: 115.2 };
    expect(pickInstalledRegion([DIY], pos, BALI)).toBeNull();
    const updated = region('bali', BALI.bbox, '20261201');
    expect(pickInstalledRegion([updated], pos, BALI)?.version).toBe('20261201');
  });

  test('without a position it keeps the current region while it is still installed', () => {
    expect(pickInstalledRegion([BALI], null, BALI)?.id).toBe('bali');
    expect(pickInstalledRegion([], null, BALI)).toBeNull();
  });
});

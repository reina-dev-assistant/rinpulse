import { describe, expect, it } from 'bun:test';

import { parseExportCounts, sourceRows, splitSources, WATCH_STALE_SEC, type SourceFacts } from './model';

const NOW = 1_760_000_000;

const base: SourceFacts = {
  nowSec: NOW,
  watch: { name: 'WATCH FIT 4 Pro', paired: true, lastSyncSec: NOW - 3600, stepDays: 6, sleepNights: 5, workouts: 2 },
  health: { store: 'Health Connect', availability: 'available', enabled: true, granted: 9, total: 9, lastExportSec: NOW - 3600, lastError: null, counts: { steps: 120, hr: 340, workouts: 1 } },
  strava: { connected: true, lastUploadSec: NOW - 86400, uploaded: 3, failed: 0 },
  joyorogo: { configured: true, signedIn: true, email: 'a@b.id', lastSentMs: (NOW - 7200) * 1000, sent: 14, waiting: 1, lastError: null },
  scale: { name: 'Scale X', lastWeighMs: (NOW - 86400) * 1000, weighIns: 4, waiting: 0 },
};

const row = (facts: SourceFacts, id: string) => sourceRows(facts).find((r) => r.id === id)!;

describe('parseExportCounts', () => {
  it('reads the export line and ignores keys it does not show', () => {
    expect(parseExportCounts('steps=120 distance=120 calories=1 hr=340 spo2=0 restingHr=2 sleep=7 workouts=1 routes=0')).toEqual({ steps: 120, hr: 340, sleep: 7, workouts: 1 });
  });

  it('is null without a line', () => {
    expect(parseExportCounts(null)).toBeNull();
    expect(parseExportCounts('')).toBeNull();
  });
});

describe('sourceRows', () => {
  it('words the watch with its channel, last sync and what the last week carried', () => {
    const r = row(base, 'watch');
    expect(r).toMatchObject({ state: 'on', via: 'Bluetooth, langsung dari jam' });
    expect(r.counts).toBe('7 hari terakhir: 6 hari langkah · 5 malam tidur · 2 latihan');
    expect(r.last).toStartWith('Sinkron terakhir ');
  });

  it('flags a watch that has not synced for over two days, or never', () => {
    expect(row({ ...base, watch: { ...base.watch, lastSyncSec: NOW - WATCH_STALE_SEC - 1 } }, 'watch').state).toBe('attention');
    const never = row({ ...base, watch: { ...base.watch, lastSyncSec: null, stepDays: 0, sleepNights: 0, workouts: 0 } }, 'watch');
    expect(never).toMatchObject({ state: 'attention', last: 'Belum pernah sinkron' });
    expect(never.counts).toBe('7 hari terakhir: belum ada yang tersimpan');
  });

  it('shows an unpaired watch as not set up, with the next step and no invented counts', () => {
    const r = row({ ...base, watch: { ...base.watch, paired: false } }, 'watch');
    expect(r).toMatchObject({ state: 'off', last: null, counts: null });
    expect(r.note).toContain('Pasangkan');
  });

  it('reports the last Health Connect write with what it wrote and a missing permission', () => {
    const r = row({ ...base, health: { ...base.health, granted: 7 } }, 'health');
    expect(r.state).toBe('on');
    expect(r.counts).toBe('Tulisan terakhir: 120 langkah · 340 bacaan detak jantung · 1 latihan');
    expect(r.note).toContain('7 dari 9');
  });

  it('marks a failed write as needing a look, and a switched-off or missing store as not set up', () => {
    expect(row({ ...base, health: { ...base.health, lastError: 'boom' } }, 'health')).toMatchObject({ state: 'attention' });
    expect(row({ ...base, health: { ...base.health, enabled: false } }, 'health').state).toBe('off');
    expect(row({ ...base, health: { ...base.health, availability: 'unavailable' } }, 'health').state).toBe('off');
  });

  it('counts Strava uploads and flags failures', () => {
    expect(row(base, 'strava').counts).toBe('7 hari terakhir: 3 latihan terunggah');
    const r = row({ ...base, strava: { ...base.strava, failed: 2 } }, 'strava');
    expect(r).toMatchObject({ state: 'attention' });
    expect(r.counts).toBe('7 hari terakhir: 3 latihan terunggah · 2 gagal');
  });

  it('says what JoyoRogo has been sent and what waits, and leaves the row out without a cloud server', () => {
    expect(row(base, 'joyorogo').counts).toBe('14 terkirim seluruhnya, 1 menunggu sinkron berikutnya');
    expect(row(base, 'joyorogo').via).toBe('Akun a@b.id');
    expect(sourceRows({ ...base, joyorogo: { ...base.joyorogo, configured: false } }).map((r) => r.id)).not.toContain('joyorogo');
  });

  it('counts weigh-ins and the ones JoyoRogo has not got yet', () => {
    expect(row(base, 'scale').counts).toBe('7 hari terakhir: 4 timbangan');
    expect(row({ ...base, scale: { ...base.scale, waiting: 2 } }, 'scale').counts).toBe('7 hari terakhir: 4 timbangan · 2 menunggu JoyoRogo');
    expect(row({ ...base, scale: { ...base.scale, name: null } }, 'scale').state).toBe('off');
  });
});

describe('splitSources', () => {
  it('puts what is set up first, needing-a-look included, and what is not after', () => {
    const rows = sourceRows({ ...base, strava: { ...base.strava, connected: false }, watch: { ...base.watch, lastSyncSec: null } });
    const { connected, available } = splitSources(rows);
    expect(connected.map((r) => r.id)).toEqual(['watch', 'health', 'joyorogo', 'scale']);
    expect(available.map((r) => r.id)).toEqual(['strava']);
  });
});

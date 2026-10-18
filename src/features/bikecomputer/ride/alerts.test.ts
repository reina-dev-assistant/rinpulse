import { describe, expect, it } from 'bun:test';

import type { AlertConfig, AlertKind, RideAlert } from '../types';
import { AlertEngine, alertPriority, type AlertInput, type AlertProfile, vibrationPattern } from './alerts';

const T0 = 1_700_000_000_000;

/** Everything off: each test turns on only what it checks. */
const OFF: AlertConfig = {
  hr: { enabled: false, minZone: 1, maxZone: 5 },
  power: { enabled: false, minZone: 1, maxZone: 7 },
  cadence: { enabled: false, minRpm: 60, maxRpm: 110 },
  eat: { enabled: false, everySec: null, everyM: null },
  drink: { enabled: false, everySec: null, everyM: null },
  offCourse: false,
  lowBattery: false,
  sensorLost: false,
  gpsLost: false,
  vibrate: true,
  sound: false,
};

const PROFILE: AlertProfile = { maxHr: 190, ftp: 200 };

function cfg(over: Partial<AlertConfig>): AlertConfig {
  return { ...OFF, ...over };
}

function base(sec: number, over: Partial<AlertInput> = {}): AlertInput {
  return {
    nowMs: T0 + sec * 1000,
    movingSec: sec,
    distanceM: sec * 5,
    hr: null,
    watts: null,
    cadence: null,
    offCourse: false,
    batteryPct: null,
    charging: false,
    sensorsLost: [],
    fixAgeSec: null,
    autoLapped: false,
    turnInM: null,
    ...over,
  };
}

/** Seconds (from `T0`) at which `kind` fired when `make(sec)` is fed once a second from 0 to `to`. */
function firesAt(engine: AlertEngine, to: number, make: (sec: number) => Partial<AlertInput>, kind?: AlertKind): number[] {
  const out: number[] = [];
  for (let sec = 0; sec <= to; sec++) {
    for (const a of engine.update(base(sec, make(sec)))) if (kind === undefined || a.kind === kind) out.push(sec);
  }
  return out;
}

function kinds(alerts: RideAlert[]): AlertKind[] {
  return alerts.map((a) => a.kind);
}

describe('heart rate zone alert', () => {
  const hrCfg = cfg({ hr: { enabled: true, minZone: 2, maxZone: 4 } });

  it('fires after 10 s outside the band, repeats every 30 s, stops when back inside', () => {
    const e = new AlertEngine(hrCfg, PROFILE);
    // 175 / 190 = 92 %: zone 5.
    expect(firesAt(e, 80, () => ({ hr: 175 }), 'hrHigh')).toEqual([10, 40, 70]);
  });

  it('the alert carries the zone', () => {
    const e = new AlertEngine(hrCfg, PROFILE);
    let last: RideAlert | undefined;
    for (let sec = 0; sec <= 10; sec++) for (const a of e.update(base(sec, { hr: 175 }))) last = a;
    expect(last).toEqual({ kind: 'hrHigh', at: T0 + 10_000, value: 5 });
  });

  it('does not fire at 9 s', () => {
    const e = new AlertEngine(hrCfg, PROFILE);
    expect(firesAt(e, 9, () => ({ hr: 175 }))).toEqual([]);
  });

  it('re-arms when back inside, then needs a fresh 10 s', () => {
    const e = new AlertEngine(hrCfg, PROFILE);
    // Outside 0-14 (fires at 10), inside 15-24 (146 / 190 = 77 %: zone 3), outside again from 25: fires at 35.
    const hr = (sec: number) => (sec >= 15 && sec < 25 ? 146 : 175);
    expect(firesAt(e, 40, (sec) => ({ hr: hr(sec) }), 'hrHigh')).toEqual([10, 35]);
  });

  it('a null reading breaks the run and fires nothing', () => {
    const e = new AlertEngine(hrCfg, PROFILE);
    const hr = (sec: number) => (sec === 6 ? null : 175);
    expect(firesAt(e, 20, (sec) => ({ hr: hr(sec) }), 'hrHigh')).toEqual([17]);
  });

  it('no alert while the reading stays null', () => {
    const e = new AlertEngine(hrCfg, PROFILE);
    expect(firesAt(e, 120, () => ({ hr: null }))).toEqual([]);
  });

  it('too low alerts as hrLow, and a swing from low to high restarts the dwell', () => {
    const e = new AlertEngine(hrCfg, PROFILE);
    // 105 / 190 = 55 %: zone 1, below the band.
    const low = firesAt(e, 12, () => ({ hr: 105 }), 'hrLow');
    expect(low).toEqual([10]);
    const e2 = new AlertEngine(hrCfg, PROFILE);
    const swing = firesAt(e2, 25, (sec) => ({ hr: sec < 8 ? 105 : 175 }));
    // Low from 0, high from 8: the dwell restarts at 8 and fires at 18.
    expect(swing).toEqual([18]);
  });

  it('zone edges: 60 % is zone 2, 90 % is zone 5', () => {
    const e = new AlertEngine(cfg({ hr: { enabled: true, minZone: 2, maxZone: 4 } }), { maxHr: 200, ftp: null });
    expect(firesAt(e, 30, () => ({ hr: 120 }))).toEqual([]);
    const e2 = new AlertEngine(cfg({ hr: { enabled: true, minZone: 2, maxZone: 4 } }), { maxHr: 200, ftp: null });
    expect(firesAt(e2, 30, () => ({ hr: 179 }))).toEqual([]);
    const e3 = new AlertEngine(cfg({ hr: { enabled: true, minZone: 2, maxZone: 4 } }), { maxHr: 200, ftp: null });
    expect(firesAt(e3, 10, () => ({ hr: 180 }), 'hrHigh')).toEqual([10]);
  });

  it('below 50 % counts as zone 1, so minZone 1 never alerts low', () => {
    const e = new AlertEngine(cfg({ hr: { enabled: true, minZone: 1, maxZone: 5 } }), PROFILE);
    expect(firesAt(e, 60, () => ({ hr: 70 }))).toEqual([]);
  });

  it('needs the max heart rate and the switch', () => {
    const noMax = new AlertEngine(hrCfg, { maxHr: null, ftp: 200 });
    expect(firesAt(noMax, 60, () => ({ hr: 190 }))).toEqual([]);
    const off = new AlertEngine(OFF, PROFILE);
    expect(firesAt(off, 60, () => ({ hr: 190 }))).toEqual([]);
  });
});

describe('power zone alert', () => {
  const pCfg = cfg({ power: { enabled: true, minZone: 2, maxZone: 5 } });

  it('fires in zone 6 (FTP 200: from 240 W) after the dwell', () => {
    const e = new AlertEngine(pCfg, PROFILE);
    let value: number | null = null;
    const at = firesAt(e, 40, () => ({ watts: 250 }), 'powerHigh');
    expect(at).toEqual([10, 40]);
    const e2 = new AlertEngine(pCfg, PROFILE);
    for (let sec = 0; sec <= 10; sec++) for (const a of e2.update(base(sec, { watts: 250 }))) value = a.value;
    expect(value).toBe(6);
  });

  it('239 W is zone 5, inside; 240 W is zone 6', () => {
    const e = new AlertEngine(pCfg, PROFILE);
    expect(firesAt(e, 60, () => ({ watts: 239 }))).toEqual([]);
    const e2 = new AlertEngine(pCfg, PROFILE);
    expect(firesAt(e2, 10, () => ({ watts: 240 }), 'powerHigh')).toEqual([10]);
  });

  it('zone 1 is below the band: powerLow', () => {
    const e = new AlertEngine(pCfg, PROFILE);
    expect(firesAt(e, 10, () => ({ watts: 60 }), 'powerLow')).toEqual([10]);
    const inside = new AlertEngine(pCfg, PROFILE);
    // 110 W is the start of zone 2.
    expect(firesAt(inside, 60, () => ({ watts: 110 }))).toEqual([]);
  });

  it('a zero reading is zone 1 (a coasting rider), and null is silent', () => {
    const e = new AlertEngine(pCfg, PROFILE);
    expect(firesAt(e, 10, () => ({ watts: 0 }), 'powerLow')).toEqual([10]);
    const e2 = new AlertEngine(pCfg, PROFILE);
    expect(firesAt(e2, 60, () => ({ watts: null }))).toEqual([]);
  });

  it('needs an FTP', () => {
    const e = new AlertEngine(pCfg, { maxHr: 190, ftp: null });
    expect(firesAt(e, 60, () => ({ watts: 500 }))).toEqual([]);
  });
});

describe('cadence alert', () => {
  const cCfg = cfg({ cadence: { enabled: true, minRpm: 70, maxRpm: 100 } });

  it('low cadence fires after 10 s with the rpm', () => {
    const e = new AlertEngine(cCfg, PROFILE);
    const alerts: RideAlert[] = [];
    for (let sec = 0; sec <= 10; sec++) alerts.push(...e.update(base(sec, { cadence: 60 })));
    expect(alerts).toEqual([{ kind: 'cadenceLow', at: T0 + 10_000, value: 60 }]);
  });

  it('high cadence fires as cadenceHigh', () => {
    const e = new AlertEngine(cCfg, PROFILE);
    expect(firesAt(e, 10, () => ({ cadence: 115 }), 'cadenceHigh')).toEqual([10]);
  });

  it('0 rpm is coasting: it never alerts', () => {
    const e = new AlertEngine(cCfg, PROFILE);
    expect(firesAt(e, 120, () => ({ cadence: 0 }))).toEqual([]);
  });

  it('a coasting second breaks the run', () => {
    const e = new AlertEngine(cCfg, PROFILE);
    expect(firesAt(e, 20, (sec) => ({ cadence: sec === 5 ? 0 : 60 }))).toEqual([16]);
  });

  it('inside the band is quiet, and the bounds are inclusive', () => {
    const e = new AlertEngine(cCfg, PROFILE);
    expect(firesAt(e, 60, (sec) => ({ cadence: sec % 2 === 0 ? 70 : 100 }))).toEqual([]);
  });

  it('repeats every 30 s while still outside', () => {
    const e = new AlertEngine(cCfg, PROFILE);
    expect(firesAt(e, 75, () => ({ cadence: 50 }))).toEqual([10, 40, 70]);
  });
});

describe('eat and drink reminders', () => {
  it('by time: first after one interval, then each interval', () => {
    const e = new AlertEngine(cfg({ eat: { enabled: true, everySec: 600, everyM: null } }), PROFILE);
    expect(firesAt(e, 1900, () => ({}), 'eat')).toEqual([600, 1200, 1800]);
  });

  it('by distance', () => {
    const e = new AlertEngine(cfg({ drink: { enabled: true, everySec: null, everyM: 5000 } }), PROFILE);
    // Distance 5 m per second: 5000 m at second 1000.
    expect(firesAt(e, 2100, () => ({}), 'drink')).toEqual([1000, 2000]);
  });

  it('time and distance are independent and merge into one alert when due together', () => {
    const e = new AlertEngine(cfg({ eat: { enabled: true, everySec: 1000, everyM: 5000 } }), PROFILE);
    // Both hit at second 1000: one alert, not two.
    expect(firesAt(e, 1100, () => ({}), 'eat')).toEqual([1000]);

    const e2 = new AlertEngine(cfg({ eat: { enabled: true, everySec: 1000, everyM: 3000 } }), PROFILE);
    // Distance 3000 m at second 600, 6000 at 1200; time at 1000.
    expect(firesAt(e2, 1300, () => ({}), 'eat')).toEqual([600, 1000, 1200]);
  });

  it('eat and drink are independent', () => {
    const e = new AlertEngine(
      cfg({ eat: { enabled: true, everySec: 600, everyM: null }, drink: { enabled: true, everySec: 900, everyM: null } }),
      PROFILE,
    );
    const seen: [number, AlertKind][] = [];
    for (let sec = 0; sec <= 1800; sec++) for (const a of e.update(base(sec))) seen.push([sec, a.kind]);
    expect(seen).toEqual([
      [600, 'eat'],
      [900, 'drink'],
      [1200, 'eat'],
      [1800, 'eat'],
      [1800, 'drink'],
    ]);
  });

  it('never fires while paused: the moving time does not advance', () => {
    const e = new AlertEngine(cfg({ eat: { enabled: true, everySec: 600, everyM: null } }), PROFILE);
    for (let sec = 0; sec <= 599; sec++) expect(e.update(base(sec))).toEqual([]);
    // Moving time stays at 599 for 300 wall-clock seconds.
    for (let sec = 600; sec <= 900; sec++) expect(e.update({ ...base(sec), movingSec: 599 })).toEqual([]);
  });

  it('a pause exactly at the due moment waits for the ride to go on', () => {
    const e = new AlertEngine(cfg({ eat: { enabled: true, everySec: 600, everyM: null } }), PROFILE);
    for (let sec = 0; sec < 599; sec++) e.update(base(sec));
    // The recorder pauses with 599 s on the clock; 100 calls with the clock frozen.
    for (let k = 0; k < 100; k++) expect(e.update({ ...base(599 + k), movingSec: 599 })).toEqual([]);
    expect(kinds(e.update({ ...base(700), movingSec: 600 }))).toEqual(['eat']);
  });

  it('distance alone does not fire while the moving time is frozen', () => {
    const e = new AlertEngine(cfg({ drink: { enabled: true, everySec: null, everyM: 1000 } }), PROFILE);
    e.update({ ...base(0), movingSec: 10, distanceM: 100 });
    expect(e.update({ ...base(1), movingSec: 10, distanceM: 5000 })).toEqual([]);
  });

  it('a restored ride does not fire the intervals it already passed', () => {
    const e = new AlertEngine(cfg({ eat: { enabled: true, everySec: 600, everyM: null } }), PROFILE);
    expect(e.update({ ...base(0), movingSec: 5000 })).toEqual([]);
    expect(e.update({ ...base(1), movingSec: 5001 })).toEqual([]);
    expect(kinds(e.update({ ...base(2), movingSec: 5400 }))).toEqual(['eat']);
  });

  it('a late tick fires once and the next one stays on the grid', () => {
    const e = new AlertEngine(cfg({ eat: { enabled: true, everySec: 600, everyM: null } }), PROFILE);
    e.update({ ...base(0), movingSec: 0 });
    expect(kinds(e.update({ ...base(1), movingSec: 1300 }))).toEqual(['eat']);
    expect(e.update({ ...base(2), movingSec: 1799 })).toEqual([]);
    expect(kinds(e.update({ ...base(3), movingSec: 1800 }))).toEqual(['eat']);
  });

  it('off, or with no interval, is silent', () => {
    const off = new AlertEngine(OFF, PROFILE);
    expect(firesAt(off, 3000, () => ({}))).toEqual([]);
    const none = new AlertEngine(cfg({ eat: { enabled: true, everySec: null, everyM: null } }), PROFILE);
    expect(firesAt(none, 3000, () => ({}))).toEqual([]);
  });
});

describe('off course', () => {
  it('fires once per excursion and backOnCourse once on return', () => {
    const e = new AlertEngine(cfg({ offCourse: true }), PROFILE);
    const seen: [number, AlertKind][] = [];
    const off = (sec: number) => (sec >= 3 && sec < 8) || sec >= 12;
    for (let sec = 0; sec <= 16; sec++) for (const a of e.update(base(sec, { offCourse: off(sec) }))) seen.push([sec, a.kind]);
    expect(seen).toEqual([
      [3, 'offCourse'],
      [8, 'backOnCourse'],
      [12, 'offCourse'],
    ]);
  });

  it('is silent when switched off', () => {
    const e = new AlertEngine(OFF, PROFILE);
    expect(firesAt(e, 20, (sec) => ({ offCourse: sec > 5 }))).toEqual([]);
  });

  it('a switch off does not fire a stale backOnCourse later', () => {
    const e = new AlertEngine(OFF, PROFILE);
    firesAt(e, 5, () => ({ offCourse: true }));
    expect(e.update(base(6, { offCourse: false }))).toEqual([]);
  });
});

describe('low battery', () => {
  const bCfg = cfg({ lowBattery: true });

  function drain(e: AlertEngine, levels: number[], charging = false, from = 0): RideAlert[] {
    const out: RideAlert[] = [];
    levels.forEach((pct, i) => out.push(...e.update(base(from + i, { batteryPct: pct, charging }))));
    return out;
  }

  it('fires once at 20 % and once at 10 %', () => {
    const e = new AlertEngine(bCfg, PROFILE);
    const alerts = drain(e, [30, 25, 21, 20, 19, 18, 15, 11, 10, 9, 8, 5]);
    expect(alerts.map((a) => [a.kind, a.value])).toEqual([
      ['lowBattery', 20],
      ['lowBattery', 10],
    ]);
  });

  it('a straight drop under 10 % is one alert, not two', () => {
    const e = new AlertEngine(bCfg, PROFILE);
    const alerts = drain(e, [40, 8, 7]);
    expect(alerts.map((a) => a.value)).toEqual([8]);
  });

  it('does not fire while charging, and fires when unplugged still low', () => {
    const e = new AlertEngine(bCfg, PROFILE);
    expect(drain(e, [30, 18, 12, 9], true)).toEqual([]);
    expect(drain(e, [9], false, 10).map((a) => a.value)).toEqual([9]);
  });

  it('charged back up, the levels can alert again', () => {
    const e = new AlertEngine(bCfg, PROFILE);
    expect(drain(e, [20, 15, 10]).length).toBe(2);
    expect(drain(e, [30, 28], true, 10)).toEqual([]);
    expect(drain(e, [26, 20], false, 12).map((a) => a.value)).toEqual([20]);
  });

  it('a battery that charges a little does not alert twice at the same level', () => {
    const e = new AlertEngine(bCfg, PROFILE);
    const alerts = drain(e, [20, 21, 19, 22, 20]);
    expect(alerts.length).toBe(1);
  });

  it('is silent for null and when switched off', () => {
    const e = new AlertEngine(bCfg, PROFILE);
    expect(firesAt(e, 20, () => ({ batteryPct: null }))).toEqual([]);
    const off = new AlertEngine(OFF, PROFILE);
    expect(drain(off, [20, 10, 5])).toEqual([]);
  });
});

describe('sensor lost', () => {
  const sCfg = cfg({ sensorLost: true });

  it('fires once per loss event, again for a new id', () => {
    const e = new AlertEngine(sCfg, PROFILE);
    const seen: [number, number | null][] = [];
    const lost: string[][] = [[], ['hr'], ['hr'], ['hr', 'pm'], ['hr', 'pm'], ['pm'], [], ['hr']];
    lost.forEach((ids, sec) => {
      for (const a of e.update(base(sec, { sensorsLost: ids }))) seen.push([sec, a.value]);
    });
    // hr lost at 1; pm lost at 3 (two now); hr recovered at 5 and 6; hr lost again at 7.
    expect(seen).toEqual([
      [1, 1],
      [3, 2],
      [7, 1],
    ]);
  });

  it('a sensor that stays lost does not repeat', () => {
    const e = new AlertEngine(sCfg, PROFILE);
    expect(firesAt(e, 120, () => ({ sensorsLost: ['hr'] }), 'sensorLost')).toEqual([0]);
  });

  it('is silent when disabled, and a sensor lost then is not announced late', () => {
    const e = new AlertEngine(OFF, PROFILE);
    expect(firesAt(e, 10, () => ({ sensorsLost: ['hr'] }))).toEqual([]);
  });
});

describe('GPS lost', () => {
  const gCfg = cfg({ gpsLost: true });

  it('fires once past 10 s without a fix and gpsBack once when a fix returns', () => {
    const e = new AlertEngine(gCfg, PROFILE);
    const seen: [number, AlertKind, number | null][] = [];
    const age = [1, 4, 10, 11, 12, 30, 31, 2, 3, 1];
    age.forEach((fixAgeSec, sec) => {
      for (const a of e.update(base(sec, { fixAgeSec }))) seen.push([sec, a.kind, a.value]);
    });
    expect(seen).toEqual([
      [3, 'gpsLost', 11],
      [7, 'gpsBack', null],
    ]);
  });

  it('exactly 10 s is not lost', () => {
    const e = new AlertEngine(gCfg, PROFILE);
    expect(firesAt(e, 5, () => ({ fixAgeSec: 10 }))).toEqual([]);
  });

  it('an unknown fix age says nothing, and a loss that never recovers is one alert', () => {
    const e = new AlertEngine(gCfg, PROFILE);
    expect(firesAt(e, 20, () => ({ fixAgeSec: null }))).toEqual([]);
    const e2 = new AlertEngine(gCfg, PROFILE);
    expect(firesAt(e2, 100, (sec) => ({ fixAgeSec: 20 + sec }))).toEqual([0]);
  });

  it('is silent when disabled', () => {
    const e = new AlertEngine(OFF, PROFILE);
    expect(firesAt(e, 20, (sec) => ({ fixAgeSec: sec < 10 ? 30 : 1 }))).toEqual([]);
  });
});

describe('auto-lap alert', () => {
  it('fires on the update that carries the lap, once per lap', () => {
    const e = new AlertEngine(OFF, PROFILE);
    const flags = [false, true, true, false, true];
    const seen: number[] = [];
    flags.forEach((autoLapped, sec) => {
      for (const a of e.update(base(sec, { autoLapped }))) if (a.kind === 'autoLap') seen.push(sec);
    });
    expect(seen).toEqual([1, 4]);
  });
});

describe('turn alert', () => {
  function turns(values: (number | null | undefined)[]): [number, number | null][] {
    const e = new AlertEngine(OFF, PROFILE);
    const seen: [number, number | null][] = [];
    values.forEach((turnInM, sec) => {
      for (const a of e.update(base(sec, { turnInM }))) if (a.kind === 'turn') seen.push([sec, a.value]);
    });
    return seen;
  }

  it('once each at 300, 100 and 30 m', () => {
    expect(turns([500, 400, 300, 299, 150, 101, 100, 99, 60, 31, 30, 29, 10, 0])).toEqual([
      [2, 300],
      [6, 100],
      [10, 30],
    ]);
  });

  it('a new turn (the distance jumps up) re-arms the three levels', () => {
    expect(turns([120, 60, 20, 5, 450, 301, 280, 120, 90, 25])).toEqual([
      [0, 300],
      [1, 100],
      [2, 30],
      [6, 300],
      [8, 100],
      [9, 30],
    ]);
  });

  it('skipping levels announces the nearest and spends the farther ones', () => {
    expect(turns([400, 90, 80, 25])).toEqual([
      [1, 100],
      [3, 30],
    ]);
    expect(turns([350, 20])).toEqual([[1, 30]]);
  });

  it('GPS wobble of a few metres does not re-arm', () => {
    expect(turns([301, 299, 305, 298, 310, 295])).toEqual([[1, 300]]);
  });

  it('a turn that appears close announces its nearest level only', () => {
    expect(turns([25, 24])).toEqual([[0, 30]]);
  });

  it('no turn, no alert', () => {
    expect(turns([null, undefined, null])).toEqual([]);
  });

  it('a turn that disappears and a new one that appears far away re-arms', () => {
    expect(turns([20, null, null, 350, 250])).toEqual([
      [0, 30],
      [4, 300],
    ]);
  });
});

describe('engine', () => {
  it('returns several alerts of one second in a fixed order, stamped with the instant', () => {
    const e = new AlertEngine(
      cfg({ eat: { enabled: true, everySec: 10, everyM: null }, offCourse: true, lowBattery: true, gpsLost: true }),
      PROFILE,
    );
    e.update(base(0));
    const alerts = e.update(base(10, { offCourse: true, batteryPct: 15, fixAgeSec: 20, autoLapped: true, turnInM: 90 }));
    expect(kinds(alerts)).toEqual(['eat', 'offCourse', 'lowBattery', 'gpsLost', 'autoLap', 'turn']);
    expect(alerts.every((a) => a.at === T0 + 10_000)).toBe(true);
  });

  it('is deterministic: the same inputs give the same alerts', () => {
    const config = cfg({
      hr: { enabled: true, minZone: 2, maxZone: 4 },
      eat: { enabled: true, everySec: 120, everyM: null },
      offCourse: true,
    });
    const run = () => {
      const e = new AlertEngine(config, PROFILE);
      const out: RideAlert[] = [];
      for (let sec = 0; sec < 400; sec++) out.push(...e.update(base(sec, { hr: 100 + (sec % 100), offCourse: sec % 90 > 60 })));
      return out;
    };
    expect(run()).toEqual(run());
    expect(run().length).toBeGreaterThan(5);
  });

  it('a quiet ride is quiet', () => {
    const e = new AlertEngine(OFF, PROFILE);
    expect(firesAt(e, 600, (sec) => ({ hr: 150, watts: 180, cadence: 90, batteryPct: 80, fixAgeSec: 1, turnInM: sec % 400 + 500 }))).toEqual([]);
  });
});

const ALL_KINDS: AlertKind[] = [
  'hrHigh',
  'hrLow',
  'powerHigh',
  'powerLow',
  'cadenceLow',
  'cadenceHigh',
  'eat',
  'drink',
  'offCourse',
  'backOnCourse',
  'lowBattery',
  'sensorLost',
  'gpsLost',
  'gpsBack',
  'autoLap',
  'turn',
];

describe('vibration patterns', () => {
  it('every kind has a pattern under 1.5 s that starts with no wait', () => {
    for (const kind of ALL_KINDS) {
      const p = vibrationPattern(kind);
      expect(p.length).toBeGreaterThanOrEqual(2);
      expect(p[0]).toBe(0);
      expect(p.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1500);
      expect(p.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
    }
  });

  it('no two kinds share a pattern', () => {
    const keys = ALL_KINDS.map((k) => vibrationPattern(k).join(','));
    expect(new Set(keys).size).toBe(ALL_KINDS.length);
  });

  it('heart rate high is long-long and the eat reminder is two short taps', () => {
    expect(vibrationPattern('hrHigh')).toEqual([0, 500, 150, 500]);
    const eat = vibrationPattern('eat');
    const buzzes = eat.filter((_, i) => i % 2 === 1);
    expect(buzzes.length).toBe(2);
    expect(buzzes.every((n) => n <= 200)).toBe(true);
    const drink = vibrationPattern('drink').filter((_, i) => i % 2 === 1);
    expect(drink.length).toBe(3);
  });

  it('returns a copy', () => {
    const p = vibrationPattern('eat');
    p.push(999);
    expect(vibrationPattern('eat')).not.toContain(999);
  });
});

describe('alert priority', () => {
  it('ranks the safety alerts urgent and the reminders info', () => {
    expect(alertPriority('hrHigh')).toBe('urgent');
    expect(alertPriority('offCourse')).toBe('urgent');
    expect(alertPriority('lowBattery')).toBe('urgent');
    expect(alertPriority('gpsLost')).toBe('urgent');
    expect(alertPriority('eat')).toBe('info');
    expect(alertPriority('drink')).toBe('info');
    expect(alertPriority('autoLap')).toBe('info');
    expect(alertPriority('backOnCourse')).toBe('info');
    expect(alertPriority('gpsBack')).toBe('info');
    expect(alertPriority('powerLow')).toBe('warn');
    expect(alertPriority('turn')).toBe('warn');
  });

  it('every kind has a priority', () => {
    for (const kind of ALL_KINDS) expect(['info', 'warn', 'urgent']).toContain(alertPriority(kind));
  });
});

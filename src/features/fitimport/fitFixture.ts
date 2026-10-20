/**
 * Test-only: cycling and running activity files built with JoyoFit's own FIT encoder (`../strava/fitEncoder`), laid out
 * the way a bike computer writes them (file_id, records with position, heart rate, cadence, power and cumulative
 * distance, a lap and a session with the totals). Never imported by app code.
 */
import { type FitFieldDef, type FitValue, FitWriter, toFitTime, toSemicircles } from '../strava/fitEncoder';

export interface FixtureOptions {
  /** Unix seconds. */
  start: number;
  /** Seconds between the first and the last record. */
  elapsed?: number;
  /** Seconds between records. */
  step?: number;
  /** Seconds of `total_timer_time`; defaults to `elapsed`. */
  timer?: number;
  /** FIT `sport` and `sub_sport` enum numbers: 2 = cycling, 1 = running, 11 = walking, 17 = hiking; sub 0 generic, 6 indoor cycling. */
  sport?: number;
  subSport?: number;
  /** FIT `manufacturer`: 115 = iGPSPORT, 1 = Garmin, 255 = development. Null leaves the field out. */
  manufacturer?: number | null;
  /** FIT file type: 4 = activity, 2 = settings. */
  fileType?: number;
  withSession?: boolean;
  withGps?: boolean;
  /** Metres. */
  distance?: number;
  calories?: number;
  /** Number of `lap` messages that split the file evenly (default 1, the single lap a bike computer writes without lap presses). */
  laps?: number;
  /** Adds `step_length` (1050 mm) to every record. */
  stepLength?: boolean;
  /** Adds `fractional_cadence` (0.5) to every record. */
  fractionalCadence?: boolean;
  /** Record `cadence` (default 85); null leaves the field out of every record. */
  cadence?: number | null;
  /** Adds the session's `avg_step_length` (1050 mm). */
  sessionStepLength?: boolean;
  /** Adds the session's `avg_fractional_cadence` (0.5) and `max_fractional_cadence` (0.25). */
  sessionFractionalCadence?: boolean;
}

const MESG = { fileId: 0, session: 18, lap: 19, record: 20, activity: 34 } as const;

/** One message with only the fields that have a value. */
function message(fit: FitWriter, local: number, global: number, entries: readonly (readonly [number, FitFieldDef['type'], FitValue])[]): void {
  const present = entries.filter(([, , value]) => value !== null && value !== undefined);
  const definition = fit.define(
    local,
    global,
    present.map(([num, type]): FitFieldDef => ({ num, type })),
  );
  fit.write(
    definition,
    present.map(([, , value]) => value),
  );
}

/** A ride in Jakarta: a straight line north from -6.2, 106.8 with heart rate 120..159, 200 W and 85 rpm. */
export function buildActivityFile(options: FixtureOptions): Uint8Array {
  const elapsed = options.elapsed ?? 3600;
  const step = options.step ?? 10;
  const timer = options.timer ?? elapsed;
  const distance = options.distance ?? 20_000;
  const fit = new FitWriter();
  const start = toFitTime(options.start);

  message(fit, 0, MESG.fileId, [
    [0, 'enum', options.fileType ?? 4],
    [1, 'uint16', options.manufacturer === undefined ? 115 : options.manufacturer],
    [2, 'uint16', 1],
    [3, 'uint32z', 123456],
    [4, 'uint32', start],
  ]);

  const gps = options.withGps ?? true;
  const fields: FitFieldDef[] = [{ num: 253, type: 'uint32' }];
  if (gps) fields.push({ num: 0, type: 'sint32' }, { num: 1, type: 'sint32' });
  fields.push({ num: 2, type: 'uint16' }, { num: 3, type: 'uint8' });
  const cadence = options.cadence === undefined ? 85 : options.cadence;
  if (cadence !== null) fields.push({ num: 4, type: 'uint8' });
  fields.push({ num: 5, type: 'uint32' }, { num: 6, type: 'uint16' }, { num: 7, type: 'uint16' });
  if (options.fractionalCadence) fields.push({ num: 53, type: 'uint8' });
  if (options.stepLength) fields.push({ num: 85, type: 'uint16' });
  const record = fit.define(1, MESG.record, fields);
  const count = Math.floor(elapsed / step) + 1;
  for (let i = 0; i < count; i++) {
    const t = i * step;
    const values: FitValue[] = [start + t];
    if (gps) values.push(toSemicircles(-6.2 + i * 0.0001), toSemicircles(106.8));
    // Altitude (m + 500) * 5: 10 m rising 1 m per record.
    values.push((10 + i + 500) * 5, 120 + (i % 40));
    if (cadence !== null) values.push(cadence);
    values.push(Math.round(((distance * t) / elapsed) * 100), Math.round((distance / timer) * 1000), 200);
    if (options.fractionalCadence) values.push(64);
    if (options.stepLength) values.push(10_500);
    fit.write(record, values);
  }

  if (options.withSession ?? true) {
    const avgSpeed = Math.round((distance / timer) * 1000);
    const laps = options.laps ?? 1;
    for (let n = 0; n < laps; n++) {
      const lapElapsed = elapsed / laps;
      message(fit, 2, MESG.lap, [
        [253, 'uint32', start + Math.round(lapElapsed * (n + 1))],
        [2, 'uint32', start + Math.round(lapElapsed * n)],
        [7, 'uint32', Math.round(lapElapsed * 1000)],
        [8, 'uint32', Math.round((lapElapsed * timer * 1000) / elapsed)],
        [9, 'uint32', Math.round((distance * 100) / laps)],
        [15, 'uint8', 130 + n],
        [16, 'uint8', 160 + n],
        [17, 'uint8', 80 + n],
      ]);
    }
    message(fit, 3, MESG.session, [
      [253, 'uint32', start + elapsed],
      [2, 'uint32', start],
      [5, 'enum', options.sport ?? 2],
      [6, 'enum', options.subSport ?? 0],
      [7, 'uint32', elapsed * 1000],
      [8, 'uint32', timer * 1000],
      [9, 'uint32', distance * 100],
      [11, 'uint16', options.calories ?? 900],
      [14, 'uint16', avgSpeed],
      [15, 'uint16', 14_000],
      [16, 'uint8', 140],
      [17, 'uint8', 171],
      [18, 'uint8', 85],
      [19, 'uint8', 112],
      [20, 'uint16', 200],
      [21, 'uint16', 640],
      [22, 'uint16', 310],
      [23, 'uint16', 295],
      [34, 'uint16', 215],
      [134, 'uint16', options.sessionStepLength ? 10_500 : null],
      [92, 'uint8', options.sessionFractionalCadence ? 64 : null],
      [93, 'uint8', options.sessionFractionalCadence ? 32 : null],
    ]);
  }
  message(fit, 4, MESG.activity, [
    [253, 'uint32', start + elapsed],
    [0, 'uint32', timer * 1000],
    [1, 'uint16', 1],
  ]);
  return fit.finish();
}

import { BleSensors } from '@/ble';
import { cloudLog as log } from '@/cloud/log';
import { sensorHub } from '@/features/sensors/instance';

import { StrengthHrSession } from './hrSession';

/** The one heart rate strap session of the strength logger. It outlives the logger screen: minimizing the workout keeps recording. */
export const strengthHr = new StrengthHrSession({
  hub: sensorHub,
  session: {
    start: (options) => BleSensors.startWorkoutSession(options),
    end: () => BleSensors.endWorkoutSession(),
  },
  now: Date.now,
  log: (message) => log(`strength: ${message}`),
});

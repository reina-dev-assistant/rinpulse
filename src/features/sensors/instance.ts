import { BleSensors } from '@/ble';

import { SensorHub, type BleSensorsApi } from './hub';

/** The one hub of the app. The native module is read on first use, so importing this file costs nothing. */
export const sensorHub = new SensorHub(() => BleSensors as unknown as BleSensorsApi);

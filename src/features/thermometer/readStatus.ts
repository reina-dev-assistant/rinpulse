import { envVersion } from './events';
import type { GattFailure } from './gattRead';

const problems = new Map<string, GattFailure>();

/** Why the newest connected read of a sensor failed, or null when it worked (or none ran). Memory only: it describes this session. */
export const readProblem = (sensorId: string): GattFailure | null => problems.get(sensorId) ?? null;

/** Records the outcome of a connected read and wakes the screens that show it. */
export function setReadProblem(sensorId: string, problem: GattFailure | null): void {
  if ((problems.get(sensorId) ?? null) === problem) return;
  if (problem === null) problems.delete(sensorId);
  else problems.set(sensorId, problem);
  envVersion.bump();
}

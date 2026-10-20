import type { RoomCaptureNative } from './roomNative';
import type { ThermometerSampler } from './sampler';
import { insertEnvSample, type EnvSample } from './store';

type Db = Parameters<typeof insertEnvSample>[0];

/**
 * Moves what the overnight scan kept (Android, while the app was closed) into `env_sample`: each advertisement goes through the same
 * sampler as a live one (paired sensors, readable frames, counter dedupe, one sample per five minutes) and the database's own
 * spacing rule. Only after every one was handled does it tell the native side to drop them, so a failure part-way loses nothing
 * and the next drain starts over (stored samples are refused as duplicates). Resolves with the samples stored.
 */
export async function drainRoomAdverts(native: Pick<RoomCaptureNative, 'roomAdverts' | 'clearRoomAdverts'>, sampler: ThermometerSampler, db: Db): Promise<EnvSample[]> {
  const adverts = await native.roomAdverts();
  if (adverts.length === 0) return [];
  const stored: EnvSample[] = [];
  let newest = 0;
  for (const advert of [...adverts].sort((a, b) => a.ts - b.ts)) {
    newest = Math.max(newest, advert.ts);
    const accepted = sampler.accept({ id: advert.id, ts: advert.ts, serviceData: { [advert.uuid]: advert.hex } });
    if (accepted && (await insertEnvSample(db, accepted.sample))) stored.push(accepted.sample);
  }
  await native.clearRoomAdverts(newest);
  return stored;
}

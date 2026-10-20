import { ThermometerSampler } from './sampler';

/** The one sampler of the app: the foreground scan, the overnight file and the Settings screen all feed samples through it, so they share one throttle. */
export const thermometerSampler = new ThermometerSampler();

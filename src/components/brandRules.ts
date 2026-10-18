/** The third-party marks JoyoFit shows next to a feature that talks to that service. Rules for each: docs/brand-marks.md. */
export type Brand = 'strava' | 'health-connect' | 'apple-health';

/**
 * Whether a mark may be drawn on this platform. Health Connect is Android's store and Apple's HealthKit artwork licence
 * allows its icon only inside an app running on iOS, so each of the two shows on its own platform and nowhere else.
 */
export function brandAllowed(brand: Brand, os: string): boolean {
  if (brand === 'apple-health') return os === 'ios';
  if (brand === 'health-connect') return os === 'android';
  return true;
}

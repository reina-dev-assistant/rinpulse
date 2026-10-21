/**
 * JoyoRogo refuses a post with `FAILED_PRECONDITION` (the only precondition `social.*` checks) when the account has no
 * profile: the profile (birth year, height, weight, goal) is made by JoyoRogo's own onboarding. A JoyoFit account that
 * never opened JoyoRogo is in that state however far it got through JoyoFit's onboarding, and the server's
 * "Finish onboarding first." reads as if JoyoFit's was not finished.
 */
export function needsRogoProfile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'FAILED_PRECONDITION';
}

/** JoyoRogo's own onboarding: the app's `app/onboarding.tsx` route, and the web route `/onboarding`. */
export const ROGO_ONBOARDING_APP_URL = 'joyorogo://onboarding?from=joyofit';
export const ROGO_ONBOARDING_WEB_URL = 'https://joyorogo.com/onboarding?utm_source=joyofit&utm_medium=app&utm_campaign=share-needs-profile';

/** The URLs to try in order: the installed JoyoRogo app, then the web onboarding. */
export const ROGO_ONBOARDING_URLS = [ROGO_ONBOARDING_APP_URL, ROGO_ONBOARDING_WEB_URL] as const;

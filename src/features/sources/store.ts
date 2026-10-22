import { isIos } from '@/components/IosUnavailable';

/** The platform's health store, by the name each platform uses. */
export const HEALTH_STORE = isIos ? 'Apple Health' : 'Health Connect'; // i18n-ok: platform brand names

import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/**
 * Version, native build and running JS update of this app; a different one is an app update (see `workoutFailures.ts`).
 * The update id is part of it because an over-the-air update can change the document too, and a server-side fix
 * needs no app change at all (see `RETRY_REFUSED_MS`).
 */
export const APP_BUILD = `${Constants.expoConfig?.version ?? '0'}+${Constants.nativeBuildVersion ?? '0'}+${Updates.updateId ?? 'embedded'}`;

import { Directory, File, Paths } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import Share from 'react-native-share';

import { getWorkout, listWorkoutPoints } from '@/db/queries';
import { t } from '@/i18n';
import { isShareCancel } from '@/features/stickers/share/shareImage';
import { buildWorkoutFit } from '@/features/strava/workoutFit';

import { buildGpx, exportFile, type ExportAction, type ExportFormat, type ExportIo, type ExportOutcome } from './workoutExport';

/** The folder the last Android save went to (a persisted Storage Access Framework tree URI). Local only. */
const FOLDER_KEY = 'joyofit.export.folder';
/** Where the Android folder picker opens. Android 11+ refuses the Downloads folder itself, so the person picks or creates a folder inside it. */
const DOWNLOADS_URI = 'content://com.android.externalstorage.documents/document/primary%3ADownload';

function writeInto(directory: Directory, name: string, mime: string, content: Uint8Array | string): string {
  const file = directory.createFile(name, mime);
  file.write(content);
  return directory.name;
}

/** Cache directory, the folder picker (Android) and the system share sheet. Closing either is not an error. */
export const deviceExportIo: ExportIo = {
  writeCacheFile(name, content) {
    const file = new File(Paths.cache, name);
    file.create({ overwrite: true });
    file.write(content);
    return file.uri;
  },
  async share(uri, mime, name) {
    try {
      await Share.open({ url: uri, type: mime, filename: name, title: name, failOnCancel: false });
    } catch (error) {
      if (!isShareCancel(error)) throw error;
    }
  },
  async saveToFolder(name, mime, content, pickFolder) {
    const remembered = pickFolder ? null : Storage.getItemSync(FOLDER_KEY);
    if (remembered) {
      try {
        return writeInto(new Directory(remembered), name, mime, content);
      } catch {
        // The folder was deleted or the permission revoked: ask again.
        Storage.removeItemSync(FOLDER_KEY);
      }
    }
    let directory: Directory;
    try {
      directory = await Directory.pickDirectoryAsync(DOWNLOADS_URI);
    } catch (error) {
      // expo-file-system rejects with "The file picker was cancelled by the user" when the picker is closed.
      if (/cancel/i.test(error instanceof Error ? error.message : String(error))) return null;
      throw error;
    }
    const folder = writeInto(directory, name, mime, content);
    Storage.setItemSync(FOLDER_KEY, directory.uri);
    return folder;
  },
};

/**
 * Builds the workout's file and saves or shares it. The FIT is the one the Strava upload sends (`buildWorkoutFit`); both work
 * offline.
 */
export async function exportWorkoutFile(
  db: SQLiteDatabase,
  workoutId: number,
  format: ExportFormat,
  action: ExportAction,
  pickFolder = false,
  io: ExportIo = deviceExportIo,
): Promise<ExportOutcome> {
  const found = await getWorkout(db, workoutId);
  if (!found) throw new Error(t('common:errors.workoutGone'));
  const { workout, summaryJson } = found;
  if (format === 'gpx') return exportFile(io, Platform.OS, workout, 'gpx', action, buildGpx(workout, await listWorkoutPoints(db, workoutId)), pickFolder);
  const { fit } = await buildWorkoutFit(db, workout, summaryJson);
  return exportFile(io, Platform.OS, workout, 'fit', action, fit.bytes, pickFolder);
}

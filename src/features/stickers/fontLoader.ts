import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono';
import * as Font from 'expo-font';

let loading: Promise<void> | null = null;

/**
 * Resolves once every face a sticker can use is registered. The Plus Jakarta Sans faces come with the root layout; the
 * IBM Plex Mono faces (receipt stickers) load here, once. Never rejects: a failed load leaves the system monospace, which
 * only changes glyph shapes, not the layout (the engine measures with the generated tables).
 */
export function ensureStickerFonts(): Promise<void> {
  loading ??= Font.loadAsync({ IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_700Bold }).catch(() => undefined);
  return loading;
}

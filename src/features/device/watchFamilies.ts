import { REPO_URL } from './supportIssue';

/**
 * The watches JoyoFit can talk to, by family, for the screens that explain it to someone who is not sure theirs works (onboarding, the
 * Watch tab before pairing). The model-by-model list is generated from `WatchModels.kt` for the website (`site/src/jam.ts`, page /jam); this is
 * the short version, and the full list is one tap away.
 */
export type WatchSupport = 'tested' | 'experimental' | 'notYet';

export interface WatchFamily {
  id: string;
  /** Names are product names, not translated. */
  name: string;
  support: WatchSupport;
}

export const WATCH_FAMILIES: readonly WatchFamily[] = [
  { id: 'fit4pro', name: 'Huawei Watch Fit 4 Pro', support: 'tested' },
  { id: 'fit', name: 'Huawei Watch Fit, Fit 2 to Fit 5 Pro', support: 'experimental' },
  { id: 'gt', name: 'Huawei Watch GT, GT 2 to GT 7 Pro, GT Runner, GT Cyber', support: 'experimental' },
  { id: 'watch', name: 'Huawei Watch 3 to 5, Watch D2, Watch Ultimate, TalkBand B6', support: 'experimental' },
  { id: 'band', name: 'Huawei Band 2 to Band 11 Pro', support: 'experimental' },
  { id: 'honor', name: 'Honor Band 3 to 10, MagicWatch 2, Watch GS 3, GS Pro, Watch 4, Watch 4 Pro', support: 'experimental' },
  { id: 'honorNew', name: 'Honor Watch 5, Watch 5 Pro, Watch 6', support: 'notYet' },
];

/** The website's full, model-by-model list. */
export const SUPPORTED_LIST_URL = 'https://fit.joyorogo.com/jam';

/** How to help get a watch supported (lend one, test, or ask). */
export const SUPPORT_PAGE_URL = 'https://fit.joyorogo.com/dukung-jam';

// i18n-ok: the request is written for the maintainers' GitHub tracker, in Indonesian like the website's own request link.
/** A new "[Permintaan jam]" issue with the form text filled in: the same request the website offers. */
export const WATCH_REQUEST_URL = `${REPO_URL}/issues/new?title=${encodeURIComponent('[Permintaan jam] ')}&body=${encodeURIComponent(
  'Model jam:\nNama Bluetooth di HP (kalau tahu):\nSaya bisa: bantu uji / pinjamkan jam / hanya meminta\n',
)}`;

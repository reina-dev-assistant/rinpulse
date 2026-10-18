import * as DocumentPicker from 'expo-document-picker';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { CustomDialogState } from '@/features/watchfaces/ThemedDialog';
import { resolveCategory, type WatchfaceItem } from '@/features/watchfaces/watchfaceModel';
import type { DownloadedFace } from '@/features/watchfaces/useWatchfaceLibrary';
import { HuaweiWear, type WatchfaceList } from '@/wear';

interface UseWatchfaceImportParams {
  list: WatchfaceList | null;
  saveToLibrary: (face: DownloadedFace) => void;
  onInstall: (face: WatchfaceItem) => void;
  setDialog: (dialog: CustomDialogState | null) => void;
}

export function useWatchfaceImport({
  list,
  saveToLibrary,
  onInstall,
  setDialog,
}: UseWatchfaceImportParams) {
  const { t } = useTranslation(['watch', 'common']);
  const promptInstallAfterSave = useCallback(
    (savedFace: DownloadedFace) => {
      const hasWatchScreen = Boolean(list?.width && list?.height);
      const targetW = list?.width ?? 0;
      const targetH = list?.height ?? 0;
      const isCompatible =
        hasWatchScreen &&
        savedFace.width > 0 &&
        savedFace.height > 0 &&
        savedFace.width === targetW &&
        savedFace.height === targetH;

      if (!isCompatible) {
        const message =
          hasWatchScreen && savedFace.width > 0 && savedFace.height > 0
            ? t('watch:faces.savedIncompatibleHint', {
                title: savedFace.title,
                faceW: savedFace.width,
                faceH: savedFace.height,
                watchW: targetW,
                watchH: targetH,
              })
            : t('watch:faces.savedUnknownHint', {
                title: savedFace.title,
                watchW: targetW || '—',
                watchH: targetH || '—',
              });
        setDialog({
          visible: true,
          icon: 'alert-circle-outline',
          title: t('watch:faces.savedToMyWatch'),
          message,
          confirmLabel: t('common:actions.ok'),
          confirmVariant: 'primary',
          onConfirm: () => setDialog(null),
        });
        return;
      }

      setDialog({
        visible: true,
        icon: 'checkmark-circle-outline',
        title: t('watch:faces.savedToMyWatch'),
        message: t('watch:faces.savedInstallPrompt', { title: savedFace.title }),
        confirmLabel: t('watch:faces.installToWatchNow'),
        confirmVariant: 'primary',
        cancelLabel: t('watch:faces.keepInMyWatch'),
        onConfirm: () => void onInstall(savedFace),
      });
    },
    [list, onInstall, setDialog, t],
  );

  const handleImportToMyWatch = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (picked.canceled || picked.assets.length === 0) return;
      const asset = picked.assets[0];

      const isHwt = asset.name.toLowerCase().endsWith('.hwt');
      if (!isHwt) {
        const isZip = asset.name.toLowerCase().endsWith('.zip');
        setDialog({
          visible: true,
          icon: 'alert-circle-outline',
          title: t('watch:faces.invalidFileExt'),
          message: isZip
            ? t('watch:faces.zipWarning', { name: asset.name })
            : t('watch:faces.notHwtWarning', { name: asset.name }),
          confirmLabel: t('common:actions.ok'),
          confirmVariant: 'primary',
          onConfirm: () => setDialog(null),
        });
        return;
      }

      let parsed;
      try {
        parsed = await HuaweiWear.parseWatchfacePackage(asset.uri, true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('watch:faces.invalidPackage');
        setDialog({
          visible: true,
          icon: 'close-circle-outline',
          title: t('watch:faces.invalidPackage'),
          message: t('watch:faces.invalidPackageHint', { name: asset.name, error: msg }),
          confirmLabel: t('common:actions.ok'),
          confirmVariant: 'primary',
          onConfirm: () => setDialog(null),
        });
        return;
      }

      const title = parsed.title || asset.name.replace(/\.hwt$/i, '');
      const author = parsed.author || t('watch:faces.customImport');
      const width = parsed.width || 0;
      const height = parsed.height || 0;
      const previewUrl = parsed.previewUri || undefined;
      const downloadPath = parsed.localUri || asset.uri;
      const description =
        parsed.description && parsed.description.trim() !== '{}' && parsed.description.trim() !== '[]'
          ? parsed.description
          : t('watch:faces.noDescription');
      const sizeLabel = asset.size ? `${Math.round(asset.size / 1024)} KB` : t('watch:faces.customSize');

      const newFace: DownloadedFace = {
        id: `local_${Date.now()}`,
        title,
        author,
        width,
        height,
        sizeLabel,
        description,
        downloadUrl: downloadPath,
        previewUrl,
        category: resolveCategory(width),
        savedAt: Date.now(),
      };

      saveToLibrary(newFace);
      promptInstallAfterSave(newFace);
    } catch {
      // ignore picker cancel
    }
  }, [list, promptInstallAfterSave, saveToLibrary, setDialog, t]);

  return { handleImportToMyWatch, promptInstallAfterSave };
}

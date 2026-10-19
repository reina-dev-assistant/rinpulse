export default {
  common: {
    close: "Tutup",
    cancel: "Batal",
  },
  language: {
    switch: "Ganti bahasa ke {{name}}",
  },
  header: {
    backToWeb: "Kembali ke JoyoFit Web",
    faceName: "Nama face",
    undo: "Urungkan",
    undoHint: "Urungkan (Ctrl+Z)",
    redo: "Ulangi",
    redoHint: "Ulangi (Ctrl+Shift+Z)",
    templates: "Template",
    openFile: "Buka file proyek (JSON)",
    saveFile: "Simpan file proyek (JSON)",
    themeLight: "Tema terang",
    themeDark: "Tema gelap",
    help: "Bantuan dan panduan ekspor",
    export: "Ekspor face",
    exportShort: "Ekspor",
  },
  panel: {
    layers: "Lapisan",
    preview: "Pratinjau",
    properties: "Properti",
    nav: "Panel editor",
  },
  sim: {
    title: "Jam simulasi",
    show: "Tampilkan",
    hide: "Sembunyikan",
  },
  toast: {
    opened: "{{name}} dibuka",
    openFailed: "File itu tidak bisa dibuka.",
    autosaveFailed: "Browser ini tidak bisa menyimpan pekerjaanmu",
    autosaveFailedBody: "Penyimpanan penuh atau diblokir. Unduh JSON proyek dari header supaya face-mu tidak hilang.",
  },
  file: {
    notProject: "Ini bukan file proyek JoyoFit Studio.",
    notJson: "File ini bukan JSON yang valid.",
    version: "Versi proyek {{version}} tidak didukung (yang didukung: {{expected}}).",
    damaged: "Lapisan proyek ini rusak.",
    defaultName: "Face-ku",
  },
} as const;

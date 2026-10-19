export default {
  common: {
    close: "Close",
    cancel: "Cancel",
  },
  language: {
    switch: "Switch language to {{name}}",
  },
  header: {
    backToWeb: "Back to JoyoFit Web",
    faceName: "Face name",
    undo: "Undo",
    undoHint: "Undo (Ctrl+Z)",
    redo: "Redo",
    redoHint: "Redo (Ctrl+Shift+Z)",
    templates: "Templates",
    openFile: "Open project JSON",
    saveFile: "Save project JSON",
    themeLight: "Light theme",
    themeDark: "Dark theme",
    help: "Help and export guide",
    export: "Export face",
    exportShort: "Export",
  },
  panel: {
    layers: "Layers",
    preview: "Preview",
    properties: "Properties",
    nav: "Editor panels",
  },
  sim: {
    title: "Simulated watch",
    show: "Show",
    hide: "Hide",
  },
  toast: {
    opened: "Opened {{name}}",
    openFailed: "That file could not be opened.",
    autosaveFailed: "This browser could not save your work",
    autosaveFailedBody: "Storage is full or blocked. Download the project JSON from the header so the face is not lost.",
  },
  file: {
    notProject: "This is not a JoyoFit Studio project file.",
    notJson: "This file is not valid JSON.",
    version: "Project version {{version}} is not supported (expected {{expected}}).",
    damaged: "The project's layers are damaged.",
    defaultName: "My face",
  },
} as const;

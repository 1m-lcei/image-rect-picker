import { DEFAULT_TEMPLATE } from "./output";

export interface Settings {
  theme: "system" | "light" | "dark";
  template: string;
}

const STORAGE_KEY = "image-rect-picker.settings";

export function loadSettings(): Settings {
  const defaults: Settings = { theme: "system", template: DEFAULT_TEMPLATE };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved?.version !== 1) return defaults;
    return {
      theme:
        saved.theme === "light" || saved.theme === "dark"
          ? saved.theme
          : "system",
      template:
        typeof saved.template === "string" ? saved.template : DEFAULT_TEMPLATE,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        theme: settings.theme,
        template:
          settings.template === DEFAULT_TEMPLATE
            ? undefined
            : settings.template,
      }),
    );
  } catch {
    // Keep controls usable when browser storage is blocked or full.
  }
}

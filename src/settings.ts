import { DEFAULT_TEMPLATE } from "./output";

export interface Settings {
  theme: "system" | "light" | "dark";
  template: string;
}

const STORAGE_KEY = "image-rect-picker.settings";
const THEME_KEY = "image-rect-picker.theme.v1";

function readSettingsRecord(): Settings {
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

export function loadSettings(): Settings {
  const settings = readSettingsRecord();
  try {
    const theme = localStorage.getItem(THEME_KEY);
    if (theme === "system" || theme === "light" || theme === "dark")
      settings.theme = theme;
  } catch {
    // The settings record still supplies defaults when storage is blocked.
  }
  return settings;
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Keep controls usable when browser storage is blocked or full.
  }
}

export function saveTheme(theme: Settings["theme"]): void {
  persist(THEME_KEY, theme);
}

export function saveTemplate(template: string): void {
  // Older installs may still have their only theme preference in this record.
  const { theme } = readSettingsRecord();
  persist(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      theme: theme === "system" ? undefined : theme,
      template: template === DEFAULT_TEMPLATE ? undefined : template,
    }),
  );
}

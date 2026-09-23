import { type Settings, saveSettings } from "./settings";

export function initTheme(toggle: HTMLButtonElement, settings: Settings): void {
  const system = matchMedia("(prefers-color-scheme: dark)");
  const choices = document.querySelectorAll<HTMLInputElement>(
    'input[name="theme"]',
  );
  for (const choice of choices) {
    choice.checked = choice.value === settings.theme;
    choice.addEventListener("change", () => {
      settings.theme = choice.value as Settings["theme"];
      saveSettings(settings);
    });
  }
  toggle.addEventListener("click", () => {
    const preference = [...choices].find((choice) => choice.checked)?.value;
    const dark =
      preference === "dark" || (preference === "system" && system.matches);
    const next = dark ? "light" : "dark";
    const value =
      next === (system.matches ? "dark" : "light") ? "system" : next;
    for (const choice of choices) choice.checked = choice.value === value;
    settings.theme = value;
    saveSettings(settings);
  });
  toggle.hidden = false;
}

import { type Settings, saveTheme } from "./settings";

export function initTheme(
  toggle: HTMLButtonElement,
  theme: Settings["theme"],
): void {
  const system = matchMedia("(prefers-color-scheme: dark)");
  const choices = document.querySelectorAll<HTMLInputElement>(
    'input[name="theme"]',
  );
  for (const choice of choices) {
    choice.checked = choice.value === theme;
    choice.addEventListener("change", () => {
      saveTheme(choice.value as Settings["theme"]);
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
    saveTheme(value);
  });
  toggle.hidden = false;
}

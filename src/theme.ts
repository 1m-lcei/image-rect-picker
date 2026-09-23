type ThemePreference = "system" | "light" | "dark";

export function initTheme(toggle: HTMLButtonElement): void {
  const system = matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="color-scheme"]',
  );
  let preference: ThemePreference = "system";

  const isDark = () =>
    preference === "dark" || (preference === "system" && system.matches);
  const apply = () => {
    const dark = isDark();
    const scheme = preference === "system" ? "light dark" : preference;
    root.dataset.theme = preference;
    root.style.colorScheme = scheme;
    if (meta) meta.content = scheme;
    toggle.querySelector(".sun")?.toggleAttribute("hidden", !dark);
    toggle.querySelector(".moon")?.toggleAttribute("hidden", dark);
    toggle.hidden = false;
  };

  toggle.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    preference = next === (system.matches ? "dark" : "light") ? "system" : next;
    apply();
  });
  system.addEventListener("change", apply);
  apply();
}

export function initTheme(toggle: HTMLButtonElement): void {
  const system = matchMedia("(prefers-color-scheme: dark)");
  const choices = document.querySelectorAll<HTMLInputElement>(
    'input[name="theme"]',
  );
  toggle.addEventListener("click", () => {
    const preference = [...choices].find((choice) => choice.checked)?.value;
    const dark =
      preference === "dark" || (preference === "system" && system.matches);
    const next = dark ? "light" : "dark";
    const value =
      next === (system.matches ? "dark" : "light") ? "system" : next;
    for (const choice of choices) choice.checked = choice.value === value;
  });
  toggle.hidden = false;
}

import type { Rect } from "./geometry";

export const DEFAULT_TEMPLATE = "{width}x{height}+{x}+{y}";

export function formatRect(rect: Rect | null, template: string): string {
  if (!rect) return "";
  const values = { ...rect, x2: rect.x + rect.width, y2: rect.y + rect.height };
  return template.replace(
    /\{(x|y|width|height|x2|y2)\}/g,
    (_, key: keyof typeof values) => String(values[key]),
  );
}

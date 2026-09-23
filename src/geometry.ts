export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point, Size {}

export type Handle = "move" | "n" | "s" | "w" | "e";

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function initialRect(size: Size): Rect {
  const width = Math.max(1, Math.round(size.width / 2));
  const height = Math.max(1, Math.round(size.height / 2));
  return {
    x: Math.min(size.width - width, Math.round(size.width / 4)),
    y: Math.min(size.height - height, Math.round(size.height / 4)),
    width,
    height,
  };
}

export function adjustRect(
  rect: Rect,
  handle: Handle,
  delta: Point,
  size: Size,
): Rect {
  const dx = Math.round(delta.x);
  const dy = Math.round(delta.y);
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  switch (handle) {
    case "move":
      return {
        ...rect,
        x: clamp(rect.x + dx, 0, size.width - rect.width),
        y: clamp(rect.y + dy, 0, size.height - rect.height),
      };
    case "n": {
      const y = clamp(rect.y + dy, 0, bottom - 1);
      return { ...rect, y, height: bottom - y };
    }
    case "s":
      return {
        ...rect,
        height: clamp(rect.height + dy, 1, size.height - rect.y),
      };
    case "w": {
      const x = clamp(rect.x + dx, 0, right - 1);
      return { ...rect, x, width: right - x };
    }
    case "e":
      return { ...rect, width: clamp(rect.width + dx, 1, size.width - rect.x) };
  }
}

export function drawRect(start: Point, end: Point, size: Size): Rect {
  const x1 = clamp(Math.round(start.x), 0, size.width);
  const y1 = clamp(Math.round(start.y), 0, size.height);
  const x2 = clamp(Math.round(end.x), 0, size.width);
  const y2 = clamp(Math.round(end.y), 0, size.height);
  return {
    x: Math.min(Math.min(x1, x2), size.width - 1),
    y: Math.min(Math.min(y1, y2), size.height - 1),
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
  };
}

export function editRect(
  rect: Rect,
  field: keyof Rect,
  raw: string,
  size: Size,
): Rect {
  const value = Number(raw);
  if (!raw.trim() || !Number.isSafeInteger(value)) {
    throw new Error("座標とサイズには整数を入力してください。");
  }
  const max = {
    x: size.width - rect.width,
    y: size.height - rect.height,
    width: size.width - rect.x,
    height: size.height - rect.y,
  }[field];
  return {
    ...rect,
    [field]: clamp(value, field === "x" || field === "y" ? 0 : 1, max),
  };
}

export function imagePoint(client: Point, origin: Point, scale: number): Point {
  return { x: (client.x - origin.x) / scale, y: (client.y - origin.y) / scale };
}

export function fitScale(image: Size, viewport: Size): number {
  return Math.min(
    1,
    Math.max(1, viewport.width) / image.width,
    Math.max(1, viewport.height) / image.height,
  );
}

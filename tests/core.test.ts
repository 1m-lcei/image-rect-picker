import { expect, test } from "bun:test";
import {
  adjustRect,
  drawRect,
  editRect,
  fitScale,
  type Handle,
  imagePoint,
  initialRect,
  type Rect,
  type Size,
  visibleHandles,
} from "../src/geometry";
import {
  ACCEPTED_TYPES,
  MAX_FILE_BYTES,
  MAX_IMAGE_PIXELS,
  validateFile,
  validateSignature,
  validateSize,
} from "../src/image";
import { DEFAULT_TEMPLATE, formatRect } from "../src/output";

const size = { width: 100, height: 80 };
const rect = { x: 20, y: 10, width: 30, height: 40 };

function valid(rectangle: Rect, bounds: Size): void {
  expect(Object.values(rectangle).every(Number.isInteger)).toBe(true);
  expect(rectangle.x).toBeGreaterThanOrEqual(0);
  expect(rectangle.y).toBeGreaterThanOrEqual(0);
  expect(rectangle.width).toBeGreaterThanOrEqual(1);
  expect(rectangle.height).toBeGreaterThanOrEqual(1);
  expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(bounds.width);
  expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(bounds.height);
}

test("初期範囲は小さな画像・奇数寸法でも画像内に収まる", () => {
  expect(initialRect({ width: 1, height: 1 })).toEqual({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  expect(initialRect({ width: 3, height: 5 })).toEqual({
    x: 1,
    y: 1,
    width: 2,
    height: 3,
  });
  for (const bounds of [
    size,
    { width: 1, height: 100 },
    { width: 101, height: 79 },
  ])
    valid(initialRect(bounds), bounds);
});

test("移動は寸法を保持し、辺の調整は反対辺を固定して境界で止まる", () => {
  const cases: [Handle, number, number, Rect][] = [
    ["move", -100, 100, { x: 0, y: 40, width: 30, height: 40 }],
    ["move", 100, -100, { x: 70, y: 0, width: 30, height: 40 }],
    ["n", 0, -100, { x: 20, y: 0, width: 30, height: 50 }],
    ["n", 0, 100, { x: 20, y: 49, width: 30, height: 1 }],
    ["s", 0, 100, { x: 20, y: 10, width: 30, height: 70 }],
    ["s", 0, -100, { x: 20, y: 10, width: 30, height: 1 }],
    ["w", -100, 0, { x: 0, y: 10, width: 50, height: 40 }],
    ["w", 100, 0, { x: 49, y: 10, width: 1, height: 40 }],
    ["e", 100, 0, { x: 20, y: 10, width: 80, height: 40 }],
    ["e", -100, 0, { x: 20, y: 10, width: 1, height: 40 }],
  ];
  for (const [handle, x, y, expected] of cases) {
    const actual = adjustRect(rect, handle, { x, y }, size);
    expect(actual).toEqual(expected);
    valid(actual, size);
  }
  for (const handle of ["move", "n", "s", "w", "e"] as const) {
    for (const distance of [-1000, -40.5, -0.49, 0, 0.51, 40.5, 1000]) {
      valid(adjustRect(rect, handle, { x: distance, y: distance }, size), size);
    }
  }
});

test("新規作成は任意方向と画像外の終点を扱い、最小1pxを保つ", () => {
  expect(drawRect({ x: 80, y: 70 }, { x: 10, y: 5 }, size)).toEqual({
    x: 10,
    y: 5,
    width: 70,
    height: 65,
  });
  for (const start of [
    { x: 0, y: 0 },
    { x: 50.5, y: 30.2 },
    { x: 100, y: 80 },
  ]) {
    for (const end of [{ x: -200, y: -200 }, start, { x: 200, y: 200 }])
      valid(drawRect(start, end, size), size);
  }
});

test("数値入力は整数だけ確定し、位置または左上を保つ", () => {
  for (const input of [
    "",
    " ",
    "1.5",
    "NaN",
    "Infinity",
    "1e999",
    "9007199254740992",
  ]) {
    expect(() => editRect(rect, "x", input, size)).toThrow();
  }
  expect(editRect(rect, "x", "999", size)).toEqual({ ...rect, x: 70 });
  expect(editRect(rect, "y", "-9", size)).toEqual({ ...rect, y: 0 });
  expect(editRect(rect, "width", "999", size)).toEqual({ ...rect, width: 80 });
  expect(editRect(rect, "height", "0", size)).toEqual({ ...rect, height: 1 });
});

test("スクロールを反映した原点と倍率から原寸に変換する", () => {
  for (const scale of [0.05, 0.1, 1, 2.5, 10]) {
    const origin = { x: -120, y: -350 };
    const point = imagePoint(
      { x: origin.x + 30 * scale, y: origin.y + 45 * scale },
      origin,
      scale,
    );
    expect(point.x).toBeCloseTo(30);
    expect(point.y).toBeCloseTo(45);
  }
  expect(
    fitScale({ width: 10000, height: 5000 }, { width: 500, height: 400 }),
  ).toBe(0.05);
  expect(fitScale({ width: 1, height: 1 }, { width: 500, height: 400 })).toBe(
    1,
  );
});

test("テンプレートは6変数を置換し、未知変数や文字列を保存する", () => {
  expect(formatRect(rect, DEFAULT_TEMPLATE)).toBe("30x40+20+10");
  expect(formatRect(rect, "{x},{y},{width},{height},{x2},{y2},{x}")).toBe(
    "20,10,30,40,50,50,20",
  );
  expect(formatRect(rect, "<script>{unknown}</script>")).toBe(
    "<script>{unknown}</script>",
  );
  expect(formatRect(rect, "")).toBe("");
  expect(formatRect(null, DEFAULT_TEMPLATE)).toBe("");
});

test("画像の形式・容量・原寸の上限を検証する", () => {
  for (const type of ACCEPTED_TYPES)
    expect(() => validateFile({ type, size: MAX_FILE_BYTES })).not.toThrow();
  for (const type of ["image/svg+xml", "", "text/plain"])
    expect(() => validateFile({ type, size: 1 })).toThrow();
  expect(() =>
    validateFile({ type: "image/png", size: MAX_FILE_BYTES + 1 }),
  ).toThrow();
  expect(() =>
    validateSize({ width: 10000, height: MAX_IMAGE_PIXELS / 10000 }),
  ).not.toThrow();
  for (const bounds of [
    { width: 10000, height: 5001 },
    { width: 0, height: 10 },
    { width: NaN, height: 1 },
    { width: 1.5, height: 1 },
  ]) {
    expect(() => validateSize(bounds)).toThrow();
  }
});

test("拡張子やMIMEを偽ったSVGを受け付けない", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  for (const type of ACCEPTED_TYPES) {
    expect(() => validateSignature(type, bytes('<svg xmlns="'))).toThrow();
  }
  for (const [type, signature] of [
    ["image/gif", "GIF89a"],
    ["image/gif", "GIF87a"],
    ["image/webp", "RIFF0000WEBP"],
    ["image/bmp", "BM"],
  ])
    expect(() =>
      validateSignature(type ?? "", bytes(signature ?? "")),
    ).not.toThrow();
  expect(() =>
    validateSignature(
      "image/png",
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ),
  ).not.toThrow();
  expect(() =>
    validateSignature("image/jpeg", new Uint8Array([255, 216, 255])),
  ).not.toThrow();
  expect(() => validateSignature("image/png", bytes("BM"))).toThrow();
});

test("ハンドルは各辺の見えている部分の中央に配置する", () => {
  const view = { x: 100, y: 200, width: 400, height: 300 };
  expect(
    visibleHandles({ x: 150, y: -1000, width: 200, height: 3000 }, view),
  ).toEqual({
    n: null,
    s: null,
    w: { x: 150, y: 350 },
    e: { x: 350, y: 350 },
  });
  expect(
    visibleHandles({ x: -1000, y: 250, width: 3000, height: 100 }, view),
  ).toEqual({
    n: { x: 300, y: 250 },
    s: { x: 300, y: 350 },
    w: null,
    e: null,
  });
  expect(
    visibleHandles({ x: 50, y: 100, width: 200, height: 300 }, view),
  ).toEqual({
    n: null,
    s: { x: 175, y: 400 },
    w: null,
    e: { x: 250, y: 300 },
  });
  expect(visibleHandles({ x: 0, y: 0, width: 10, height: 10 }, view)).toEqual({
    n: null,
    s: null,
    w: null,
    e: null,
  });
  expect(
    visibleHandles({ x: 150, y: 250, width: 1, height: 1 }, view).n,
  ).toEqual({ x: 150.5, y: 250 });
});
